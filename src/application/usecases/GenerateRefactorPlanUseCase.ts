import {
  OrganizeVaultPlan,
  OrganizeVaultProposal,
  createOrganizeVaultPlan,
  createProposal,
  ProposalDiff,
} from '../../domain/models/OrganizeVaultPlan';
import type {
  RefactorGoal,
  NoteMetadataEntry,
  VaultMetadataSnapshot,
  RefactorProgress,
} from '../../domain/models/RefactorModels';
import { applyContentRedaction, isNoteAllowedByRules, type PrivacyRule } from '../../domain/models/PrivacyRule';
import { TagNormalizationService } from '../../domain/services/TagNormalizationService';
import { TfIdfCorpus } from '../../domain/services/TfIdfCorpus';
import { ClockPort } from '../ports/ClockPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { OrganizeVaultPort } from '../ports/OrganizeVaultPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import { ConfigPort } from '../ports/ConfigPort';
import { createNotePath } from '../../domain/values/NotePath';
import { REFACTOR_PROMPTS } from '../RefactorPromptTemplates';
import {
  REFACTOR_BATCH_SIZE,
  REFACTOR_CONTENT_PREVIEW,
  REFACTOR_MAX_TAGS_IN_PROMPT,
  FLEETING_WORD_COUNT_THRESHOLD,
  FLEETING_MIN_CLUSTER_SIZE,
  REORG_LOW_CONFIDENCE_THRESHOLD,
  REORG_TIER2_TRIGGER_RATIO,
} from '../../constants';

export class GenerateRefactorPlanUseCase {
  constructor(
    private readonly clock: ClockPort,
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly store: OrganizeVaultPort,
    private readonly ai: AIProviderPort,
    private readonly config: ConfigPort,
  ) {}

  async execute(
    goal: RefactorGoal,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultPlan> {
    this.checkAborted(signal);

    onProgress({ phase: 'collecting', currentStep: 0, totalSteps: 1, message: 'Collecting vault metadata...' });
    const snapshot = await this.collectMetadata();
    this.checkAborted(signal);

    let proposals: OrganizeVaultProposal[];

    switch (goal.goalType) {
      case 'clean-up-tags':
        proposals = await this.analyzeTagCleanup(snapshot, signal, onProgress);
        break;
      case 'reorganize-notes':
        proposals = await this.analyzeNoteReorganize(snapshot, signal, onProgress);
        break;
      case 'suggest-links':
        proposals = await this.analyzeLinkSuggestions(snapshot, signal, onProgress);
        break;
      case 'consolidate-fleeting':
        proposals = await this.analyzeFleetingNotes(goal, snapshot, signal, onProgress);
        break;
    }

    onProgress({ phase: 'converting', currentStep: 1, totalSteps: 1, message: 'Saving plan...' });
    const plan = createOrganizeVaultPlan(proposals, this.clock.now());
    await this.store.save(plan);
    return plan;
  }

  private async collectMetadata(): Promise<VaultMetadataSnapshot> {
    const [noteEntries, tagFrequencies] = await Promise.all([
      this.vault.listNotesWithMetadata(),
      this.vault.listAllTags(),
    ]);

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    const filtered = noteEntries.filter(n =>
      isNoteAllowedByRules(n.path, n.tags, [], privacyRules),
    );

    const folderSet = new Set<string>();
    for (const entry of filtered) {
      if (entry.folder) folderSet.add(entry.folder);
    }

    return {
      noteEntries: filtered,
      folderTree: [...folderSet].sort(),
      tagFrequencies: [...tagFrequencies],
      totalNotes: filtered.length,
    };
  }

  // ─── Mode 2: Tag Cleanup ───

  private async analyzeTagCleanup(
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const tags = snapshot.tagFrequencies;
    if (tags.length === 0) return [];

    const canonicalIndex = TagNormalizationService.buildCanonicalIndex(tags);
    const existingMappings = canonicalIndex
      .filter(g => g.variants.length > 1)
      .map(g => `${g.canonical} ← ${g.variants.map(v => v.tag).join(', ')}`)
      .join('\n');

    const tagChunks: string[][] = [];
    for (let i = 0; i < tags.length; i += REFACTOR_MAX_TAGS_IN_PROMPT) {
      tagChunks.push(
        tags.slice(i, i + REFACTOR_MAX_TAGS_IN_PROMPT).map(t => `${t.tag} (${t.count})`),
      );
    }

    const chunkResults: string[] = [];
    for (let i = 0; i < tagChunks.length; i++) {
      this.checkAborted(signal);
      onProgress({
        phase: 'analyzing',
        currentStep: i + 1,
        totalSteps: tagChunks.length,
        message: `Analyzing tag chunk ${i + 1}/${tagChunks.length}...`,
      });

      try {
        const response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.tagCleanup.system,
          prompt: REFACTOR_PROMPTS.tagCleanup.user(tagChunks[i].join('\n'), existingMappings),
          maxTokens: 2000,
          temperature: 0.2,
          jsonMode: true,
        });
        chunkResults.push(response.content);
      } catch (err) {
        console.warn(`[Vaultend] Tag cleanup chunk ${i + 1} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (chunkResults.length === 0) return [];

    this.checkAborted(signal);
    onProgress({ phase: 'synthesizing', currentStep: 1, totalSteps: 1, message: 'Synthesizing tag analysis...' });

    let synthesized: {
      mergeGroups: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }>;
      missingTagSuggestions?: Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }>;
    };

    try {
      const synthResponse = await this.ai.callCompletion({
        systemPrompt: REFACTOR_PROMPTS.tagCleanup.system,
        prompt: REFACTOR_PROMPTS.tagCleanup.synthesis(chunkResults.join('\n---\n')),
        maxTokens: 3000,
        temperature: 0.2,
        jsonMode: true,
      });
      synthesized = JSON.parse(synthResponse.content);
    } catch {
      synthesized = this.fallbackTagSynthesis(chunkResults);
    }

    return this.convertTagProposals(synthesized, snapshot);
  }

  private fallbackTagSynthesis(chunkResults: string[]): {
    mergeGroups: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }>;
  } {
    const allGroups: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }> = [];
    for (const raw of chunkResults) {
      try {
        const parsed = JSON.parse(raw) as { mergeGroups?: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }> };
        if (parsed.mergeGroups) allGroups.push(...parsed.mergeGroups);
      } catch { /* skip */ }
    }
    return { mergeGroups: allGroups };
  }

  private convertTagProposals(
    synthesized: {
      mergeGroups: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }>;
      missingTagSuggestions?: Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }>;
    },
    snapshot: VaultMetadataSnapshot,
  ): OrganizeVaultProposal[] {
    const proposals: OrganizeVaultProposal[] = [];

    for (const group of synthesized.mergeGroups) {
      if (group.variants.length === 0) continue;
      const realVariants = group.variants.filter(v => v !== group.canonical);
      if (realVariants.length === 0) continue;

      const affectedNotes = snapshot.noteEntries
        .filter(n => n.tags.some(t => realVariants.includes(t)))
        .map(n => createNotePath(n.path));

      if (affectedNotes.length === 0) continue;

      const diffs: ProposalDiff[] = [{
        field: 'tags',
        before: realVariants.join(', '),
        after: group.canonical,
      }];

      proposals.push(createProposal({
        type: 'merge-duplicate-tags',
        targetPath: affectedNotes[0],
        diffs,
        affectedPaths: affectedNotes,
        confidence: clamp(group.confidence),
        rationale: group.rationale,
        metadata: { source: 'refactor' },
      }));
    }

    if (synthesized.missingTagSuggestions) {
      for (const suggestion of synthesized.missingTagSuggestions) {
        if (suggestion.tags.length === 0) continue;
        proposals.push(createProposal({
          type: 'apply-missing-tags',
          targetPath: createNotePath(suggestion.notePath),
          diffs: [{ field: 'tags', before: '(none)', after: suggestion.tags.join(', ') }],
          affectedPaths: [createNotePath(suggestion.notePath)],
          confidence: clamp(suggestion.confidence),
          rationale: suggestion.rationale,
          metadata: { source: 'refactor' },
        }));
      }
    }

    return proposals;
  }

  // ─── Mode 1: Note Reorganize ───

  private async analyzeNoteReorganize(
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const { noteEntries, folderTree } = snapshot;
    if (noteEntries.length === 0) return [];

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const foldersStr = folderTree.join('\n');

    const noteChunks: NoteMetadataEntry[][] = [];
    for (let i = 0; i < noteEntries.length; i += REFACTOR_BATCH_SIZE) {
      noteChunks.push([...noteEntries.slice(i, i + REFACTOR_BATCH_SIZE)]);
    }

    type PlacementResult = { path: string; suggestedFolder: string; confidence: number; rationale: string };
    const allPlacements: PlacementResult[] = [];

    for (let i = 0; i < noteChunks.length; i++) {
      this.checkAborted(signal);
      onProgress({
        phase: 'analyzing',
        currentStep: i + 1,
        totalSteps: noteChunks.length,
        message: `Analyzing notes ${i + 1}/${noteChunks.length}...`,
      });

      const chunkStr = await this.buildNoteChunkString(noteChunks[i], privacyRules);

      try {
        const response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.noteReorganize.system,
          prompt: REFACTOR_PROMPTS.noteReorganize.user(chunkStr, foldersStr),
          maxTokens: 2000,
          temperature: 0.3,
          jsonMode: true,
        });
        const parsed = JSON.parse(response.content) as PlacementResult[];
        if (Array.isArray(parsed)) allPlacements.push(...parsed);
      } catch (err) {
        console.warn(`[Vaultend] Reorganize chunk ${i + 1} failed:`, err instanceof Error ? err.message : err);
      }
    }

    const lowConfCount = allPlacements.filter(p => p.confidence < REORG_LOW_CONFIDENCE_THRESHOLD).length;
    const lowConfRatio = allPlacements.length > 0 ? lowConfCount / allPlacements.length : 0;

    if (lowConfRatio >= REORG_TIER2_TRIGGER_RATIO) {
      this.checkAborted(signal);
      onProgress({
        phase: 'analyzing',
        currentStep: noteChunks.length,
        totalSteps: noteChunks.length,
        message: 'Low confidence detected — suggesting new folders...',
      });

      const lowConfNotes = allPlacements
        .filter(p => p.confidence < REORG_LOW_CONFIDENCE_THRESHOLD)
        .map(p => noteEntries.find(n => n.path === p.path))
        .filter((n): n is NoteMetadataEntry => n !== undefined);

      const lowConfStr = await this.buildNoteChunkString(lowConfNotes, privacyRules);

      try {
        const tier2Response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.noteReorganize.tier2System,
          prompt: REFACTOR_PROMPTS.noteReorganize.tier2User(lowConfStr, foldersStr),
          maxTokens: 2000,
          temperature: 0.3,
          jsonMode: true,
        });
        const tier2 = JSON.parse(tier2Response.content) as {
          newFolders: Array<{ path: string; notes: string[]; confidence: number }>;
        };

        for (const folder of tier2.newFolders) {
          for (const notePath of folder.notes) {
            const existing = allPlacements.find(p => p.path === notePath);
            if (existing) {
              existing.suggestedFolder = folder.path;
              existing.confidence = folder.confidence;
              existing.rationale = `Moved to new folder: ${folder.path}`;
            }
          }
        }
      } catch (err) {
        console.warn('[Vaultend] Tier 2 folder suggestion failed:', err instanceof Error ? err.message : err);
      }
    }

    this.checkAborted(signal);
    onProgress({ phase: 'synthesizing', currentStep: 1, totalSteps: 1, message: 'Building proposals...' });

    return this.convertReorganizeProposals(allPlacements, noteEntries, folderTree);
  }

  private async buildNoteChunkString(
    notes: ReadonlyArray<NoteMetadataEntry>,
    privacyRules: ReadonlyArray<PrivacyRule>,
  ): Promise<string> {
    const lines: string[] = [];
    for (const note of notes) {
      let preview = '';
      try {
        const fullNote = await this.vault.readNote(createNotePath(note.path));
        if (fullNote) {
          preview = applyContentRedaction(
            fullNote.content.substring(0, REFACTOR_CONTENT_PREVIEW),
            privacyRules,
          );
        }
      } catch { /* skip */ }

      lines.push(
        `Path: ${note.path}\nFolder: ${note.folder || '/'}\nTags: ${note.tags.join(', ') || '(none)'}\nLinks: ${note.links.length}\nBacklinks: ${note.backlinks.length}\nPreview: ${preview}`,
      );
    }
    return lines.join('\n---\n');
  }

  private convertReorganizeProposals(
    placements: Array<{ path: string; suggestedFolder: string; confidence: number; rationale: string }>,
    noteEntries: ReadonlyArray<NoteMetadataEntry>,
    folderTree: ReadonlyArray<string>,
  ): OrganizeVaultProposal[] {
    const proposals: OrganizeVaultProposal[] = [];

    for (const placement of placements) {
      const entry = noteEntries.find(n => n.path === placement.path);
      if (!entry) continue;

      const currentFolder = entry.folder || '/';
      if (placement.suggestedFolder === currentFolder) continue;
      if (placement.confidence < 0.3) continue;

      const fileName = placement.path.split('/').pop() ?? '';
      const newPath = placement.suggestedFolder
        ? `${placement.suggestedFolder}/${fileName}`
        : fileName;

      const isNewFolder = !folderTree.includes(placement.suggestedFolder);

      const diffs: ProposalDiff[] = [
        { field: 'folder', before: currentFolder, after: placement.suggestedFolder },
      ];

      if (isNewFolder) {
        diffs.push({ field: 'new-folder', before: '(does not exist)', after: placement.suggestedFolder });
      }

      if (entry.backlinks.length > 0) {
        diffs.push({
          field: 'auto-update',
          before: `${entry.backlinks.length} notes link to this file`,
          after: 'wiki-links auto-updated by Obsidian',
        });
      }

      proposals.push(createProposal({
        type: 'reposition',
        targetPath: createNotePath(placement.path),
        diffs,
        affectedPaths: [
          createNotePath(placement.path),
          ...entry.backlinks.map(b => createNotePath(b)),
        ],
        confidence: clamp(placement.confidence),
        rationale: placement.rationale,
        metadata: {
          source: 'refactor',
          suggestedFolder: placement.suggestedFolder,
          newPath,
          isNewFolder,
        },
      }));
    }

    return proposals;
  }

  // ─── Mode 3: Link Suggestions ───

  private async analyzeLinkSuggestions(
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const orphans = snapshot.noteEntries.filter(
      n => n.backlinks.length === 0 && n.links.length === 0,
    );
    if (orphans.length === 0) return [];

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const proposals: OrganizeVaultProposal[] = [];

    for (let i = 0; i < orphans.length; i += REFACTOR_BATCH_SIZE) {
      const batch = orphans.slice(i, i + REFACTOR_BATCH_SIZE);
      this.checkAborted(signal);
      onProgress({
        phase: 'analyzing',
        currentStep: Math.floor(i / REFACTOR_BATCH_SIZE) + 1,
        totalSteps: Math.ceil(orphans.length / REFACTOR_BATCH_SIZE),
        message: `Analyzing orphan batch ${Math.floor(i / REFACTOR_BATCH_SIZE) + 1}...`,
      });

      for (const orphan of batch) {
        this.checkAborted(signal);
        try {
          const candidates = await this.searchIndex.search(
            orphan.path.replace('.md', '').split('/').pop() ?? '',
            10,
          );
          if (candidates.length === 0) continue;

          const candidateDescriptions: string[] = [];
          for (const c of candidates) {
            const note = await this.vault.readNote(c.notePath);
            const preview = note
              ? applyContentRedaction(note.content.substring(0, 150), privacyRules)
              : '';
            candidateDescriptions.push(`${c.notePath as string} — "${preview}"`);
          }

          let orphanPreview = '';
          const orphanNote = await this.vault.readNote(createNotePath(orphan.path));
          if (orphanNote) {
            orphanPreview = applyContentRedaction(
              orphanNote.content.substring(0, REFACTOR_CONTENT_PREVIEW),
              privacyRules,
            );
          }

          const orphanStr = `Path: ${orphan.path}\nTags: ${orphan.tags.join(', ') || '(none)'}\nPreview: ${orphanPreview}`;

          const response = await this.ai.callCompletion({
            systemPrompt: REFACTOR_PROMPTS.linkSuggest.system,
            prompt: REFACTOR_PROMPTS.linkSuggest.user(orphanStr, candidateDescriptions.join('\n')),
            maxTokens: 500,
            temperature: 0.2,
            jsonMode: true,
          });

          const result = JSON.parse(response.content) as {
            suggestedLinks: Array<{ targetPath: string; confidence: number; rationale: string }>;
          };

          if (result.suggestedLinks.length > 0) {
            const linkPaths = result.suggestedLinks.map(l => l.targetPath);
            const avgConfidence = result.suggestedLinks.reduce((s, l) => s + l.confidence, 0) / result.suggestedLinks.length;

            proposals.push(createProposal({
              type: 'reposition',
              targetPath: createNotePath(orphan.path),
              diffs: [{
                field: 'links',
                before: '(orphan — no links)',
                after: linkPaths.map(p => `[[${p.replace('.md', '')}]]`).join(', '),
              }],
              affectedPaths: [createNotePath(orphan.path), ...linkPaths.map(p => createNotePath(p))],
              confidence: clamp(avgConfidence),
              rationale: result.suggestedLinks.map(l => l.rationale).join('; '),
              metadata: {
                source: 'refactor',
                suggestedLinks: linkPaths,
              },
            }));
          }
        } catch (err) {
          console.warn(`[Vaultend] Link suggestion failed for ${orphan.path}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    return proposals;
  }

  // ─── Mode 4: Fleeting Notes ───

  private async analyzeFleetingNotes(
    goal: RefactorGoal,
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const threshold = goal.parameters.fleetingWordCountThreshold ?? FLEETING_WORD_COUNT_THRESHOLD;
    const candidates = snapshot.noteEntries.filter(
      n => n.wordCount < threshold && n.tags.length <= 1 && n.links.length <= 1,
    );
    if (candidates.length < FLEETING_MIN_CLUSTER_SIZE) return [];

    onProgress({
      phase: 'analyzing',
      currentStep: 1,
      totalSteps: 2,
      message: 'Clustering fleeting notes by similarity...',
    });

    const clusters = await this.clusterFleetingNotes(candidates);
    if (clusters.length === 0) return [];

    this.checkAborted(signal);
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const archiveFolder = settings.maintenanceArchiveFolder ?? 'Archive';
    const proposals: OrganizeVaultProposal[] = [];

    for (let i = 0; i < clusters.length; i++) {
      this.checkAborted(signal);
      onProgress({
        phase: 'synthesizing',
        currentStep: i + 1,
        totalSteps: clusters.length,
        message: `Merging cluster ${i + 1}/${clusters.length}...`,
      });

      const cluster = clusters[i];
      if (cluster.length < FLEETING_MIN_CLUSTER_SIZE) continue;

      try {
        const clusterStr = await this.buildClusterString(cluster, privacyRules);

        const response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.fleetingConsolidate.system,
          prompt: REFACTOR_PROMPTS.fleetingConsolidate.user(clusterStr),
          maxTokens: 4000,
          temperature: 0.2,
          jsonMode: true,
        });

        const result = JSON.parse(response.content) as {
          mergedTitle: string;
          mergedContent: string;
          mergedTags: string[];
          confidence: number;
          rationale: string;
        };

        const sorted = [...cluster].sort((a, b) => a.createdAt - b.createdAt);
        const survivor = sorted[0];
        let cumulativeContent = result.mergedContent;

        for (let j = 1; j < sorted.length; j++) {
          const donor = sorted[j];
          const donorFileName = donor.path.split('/').pop() ?? '';

          proposals.push(createProposal({
            type: 'merge-duplicate-notes',
            targetPath: createNotePath(survivor.path),
            diffs: [
              {
                field: 'merge',
                before: `${survivor.path.split('/').pop()} + ${donorFileName}`,
                after: `→ ${survivor.path.split('/').pop()} (survivor)`,
              },
              {
                field: 'content',
                before: `${j} notes merged so far`,
                after: `${cumulativeContent.length} chars (merged)`,
              },
              {
                field: 'donor',
                before: donor.path,
                after: `${archiveFolder}/${donorFileName}`,
              },
            ],
            affectedPaths: [createNotePath(survivor.path), createNotePath(donor.path)],
            confidence: clamp(result.confidence),
            rationale: result.rationale,
            metadata: {
              source: 'refactor',
              survivorPath: survivor.path,
              donorPath: donor.path,
              mergedContent: cumulativeContent,
              mergedTags: result.mergedTags,
              sourceBlock: `\n\n> [!info] Consolidated\n> Merged from [[${donorFileName.replace('.md', '')}]]`,
              backlinksToRedirect: [],
            },
          }));
        }
      } catch (err) {
        console.warn(`[Vaultend] Fleeting cluster ${i + 1} merge failed:`, err instanceof Error ? err.message : err);
      }
    }

    return proposals;
  }

  private async clusterFleetingNotes(
    candidates: ReadonlyArray<NoteMetadataEntry>,
  ): Promise<NoteMetadataEntry[][]> {
    const corpus = new TfIdfCorpus();

    for (const note of candidates) {
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      if (!fullNote) continue;
      const tokens = fullNote.content.toLowerCase().split(/\W+/).filter(t => t.length > 2);
      corpus.addDocument(note.path, tokens);
    }

    const vectors = new Map<string, Map<string, number>>();
    for (const note of candidates) {
      if (!corpus.hasDocument(note.path)) continue;
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      if (!fullNote) continue;
      const tokens = fullNote.content.toLowerCase().split(/\W+/).filter(t => t.length > 2);
      vectors.set(note.path, corpus.computeTfIdfVector(tokens));
    }

    const assigned = new Set<string>();
    const clusters: NoteMetadataEntry[][] = [];
    const SIMILARITY_THRESHOLD = 0.3;

    for (const note of candidates) {
      if (assigned.has(note.path) || !vectors.has(note.path)) continue;

      const cluster: NoteMetadataEntry[] = [note];
      assigned.add(note.path);
      const vecA = vectors.get(note.path)!;

      for (const other of candidates) {
        if (assigned.has(other.path) || !vectors.has(other.path)) continue;
        const vecB = vectors.get(other.path)!;
        const similarity = corpus.cosineSimilarity(vecA, vecB);
        if (similarity >= SIMILARITY_THRESHOLD) {
          cluster.push(other);
          assigned.add(other.path);
        }
      }

      if (cluster.length >= FLEETING_MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  private async buildClusterString(
    cluster: ReadonlyArray<NoteMetadataEntry>,
    privacyRules: ReadonlyArray<PrivacyRule>,
  ): Promise<string> {
    const lines: string[] = [];
    for (const note of cluster) {
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      const content = fullNote
        ? applyContentRedaction(fullNote.content, privacyRules)
        : '';

      lines.push(
        `Path: ${note.path}\nTags: ${note.tags.join(', ') || '(none)'}\nCreated: ${new Date(note.createdAt).toISOString()}\nContent:\n${content}`,
      );
    }
    return lines.join('\n===\n');
  }

  // ─── Shared ───

  private checkAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('Refactor cancelled by user', 'AbortError');
    }
  }
}

function clamp(confidence: number): number {
  return Math.max(0.3, Math.min(0.95, confidence));
}
