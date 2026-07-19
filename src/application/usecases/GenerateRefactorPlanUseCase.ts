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
import type { PreferencePort } from '../ports/PreferencePort';
import { PreferenceExtractor } from '../../domain/services/PreferenceExtractor';
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
  MISPLACED_AFFINITY_THRESHOLD,
  MISPLACED_BATCH_SIZE,
  BLOATED_FOLDER_THRESHOLD,
  THIN_FOLDER_THRESHOLD,
  PROMOTE_MATURITY_AGE_DAYS,
  PROMOTE_MIN_WORD_COUNT,
  DEFAULT_FLEETING_FOLDERS,
} from '../../constants';

export class GenerateRefactorPlanUseCase {
  constructor(
    private readonly clock: ClockPort,
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly store: OrganizeVaultPort,
    private readonly ai: AIProviderPort,
    private readonly config: ConfigPort,
    private readonly preference?: PreferencePort,
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
      case 'detect-misplaced':
        proposals = await this.analyzeMisplacedNotes(goal, snapshot, signal, onProgress);
        break;
      case 'optimize-folders':
        proposals = await this.analyzeFolderOptimization(goal, snapshot, signal, onProgress);
        break;
      case 'promote-fleeting':
        proposals = await this.analyzeFleetingPromotion(goal, snapshot, signal, onProgress);
        break;
    }

    onProgress({ phase: 'converting', currentStep: 1, totalSteps: 1, message: 'Saving plan...' });
    const now = this.clock.now();
    const filtered = await this.filterSuppressed(proposals, now);
    const plan = createOrganizeVaultPlan(filtered, now);
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
    const prefCtx = this.preference ? await this.preference.getPreferenceContext('refactor') : '';

    // Phase 2 (untagged notes) runs even if no tags exist — skip only Phase 1 (tag merge)
    if (tags.length === 0) {
      const untaggedNotes = snapshot.noteEntries.filter(
        n => n.tags.filter(t => t !== '#untagged').length === 0 && n.wordCount > 0,
      );
      if (untaggedNotes.length === 0) return [];
      const untaggedProposals = await this.analyzeUntaggedNotes(untaggedNotes, snapshot, signal, onProgress);
      const synthesized = {
        mergeGroups: [] as Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }>,
        missingTagSuggestions: untaggedProposals,
      };
      return this.convertTagProposals(synthesized, snapshot);
    }

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
    let lastError: unknown;
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
          prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.tagCleanup.user(tagChunks[i].join('\n'), existingMappings),
          maxTokens: 2000,
          temperature: 0.2,
          jsonMode: true,
        });
        chunkResults.push(response.content);
      } catch (err) {
        lastError = err;
        console.warn(`[Vaultend] Tag cleanup chunk ${i + 1} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (chunkResults.length === 0) {
      if (lastError) throw lastError;
      return [];
    }

    this.checkAborted(signal);
    onProgress({ phase: 'synthesizing', currentStep: 1, totalSteps: 1, message: 'Synthesizing tag analysis...' });

    let synthesized: {
      mergeGroups: Array<{ canonical: string; variants: string[]; confidence: number; rationale: string }>;
      missingTagSuggestions?: Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }>;
    };

    try {
      const synthResponse = await this.ai.callCompletion({
        systemPrompt: REFACTOR_PROMPTS.tagCleanup.system,
        prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.tagCleanup.synthesis(chunkResults.join('\n---\n')),
        maxTokens: 3000,
        temperature: 0.2,
        jsonMode: true,
      });
      synthesized = JSON.parse(synthResponse.content);
    } catch {
      synthesized = this.fallbackTagSynthesis(chunkResults);
    }

    // Phase 2: Untagged notes → AI suggests tags
    const untaggedNotes = snapshot.noteEntries.filter(
      n => n.tags.filter(t => t !== '#untagged').length === 0 && n.wordCount > 0,
    );

    if (untaggedNotes.length > 0) {
      const untaggedProposals = await this.analyzeUntaggedNotes(
        untaggedNotes, snapshot, signal, onProgress,
      );
      if (!synthesized.missingTagSuggestions) {
        synthesized.missingTagSuggestions = [];
      }
      for (const p of untaggedProposals) {
        synthesized.missingTagSuggestions.push(p);
      }
    }

    return this.convertTagProposals(synthesized, snapshot);
  }

  private async analyzeUntaggedNotes(
    untaggedNotes: ReadonlyArray<NoteMetadataEntry>,
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }>> {
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const prefCtx = this.preference ? await this.preference.getPreferenceContext('refactor') : '';

    const knownTags = snapshot.tagFrequencies
      .slice(0, REFACTOR_MAX_TAGS_IN_PROMPT)
      .map(t => `${t.tag} (${t.count})`)
      .join('\n');

    const results: Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }> = [];
    const chunks: NoteMetadataEntry[][] = [];
    for (let i = 0; i < untaggedNotes.length; i += REFACTOR_BATCH_SIZE) {
      chunks.push([...untaggedNotes.slice(i, i + REFACTOR_BATCH_SIZE)]);
    }

    let lastUntaggedError: unknown;
    let untaggedAiSuccessCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      this.checkAborted(signal);
      onProgress({
        phase: 'analyzing',
        currentStep: i + 1,
        totalSteps: chunks.length,
        message: `Suggesting tags for untagged notes ${i + 1}/${chunks.length}...`,
      });

      const chunkStr = await this.buildNoteChunkString(chunks[i], privacyRules);

      try {
        const response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.tagCleanup.untaggedSystem,
          prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.tagCleanup.untaggedUser(chunkStr, knownTags),
          maxTokens: 8192,
          temperature: 0.2,
          jsonMode: true,
        });
        untaggedAiSuccessCount++;
        const parsed = JSON.parse(response.content) as {
          suggestions: Array<{ notePath: string; tags: string[]; confidence: number; rationale: string }>;
        };
        if (parsed.suggestions) results.push(...parsed.suggestions);
      } catch (err) {
        lastUntaggedError = err;
        console.warn(`[Vaultend] Untagged note chunk ${i + 1} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (untaggedAiSuccessCount === 0 && lastUntaggedError) throw lastUntaggedError;
    return results;
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

  // ─── Mode 1: Note Reorganize (orphan-focused) ───

  private async analyzeNoteReorganize(
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const { noteEntries, folderTree } = snapshot;
    if (noteEntries.length === 0) return [];

    const orphans = noteEntries.filter(
      n => n.backlinks.length === 0 && n.links.length === 0,
    );
    const emptyNotes = noteEntries.filter(
      n => n.wordCount === 0 && n.backlinks.length === 0,
    );
    const emptyNonOrphans = emptyNotes.filter(
      n => n.links.length > 0,
    );

    if (orphans.length === 0 && emptyNonOrphans.length === 0) return [];

    const prefCtx = this.preference ? await this.preference.getPreferenceContext('refactor') : '';
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const archiveFolder = settings.maintenanceArchiveFolder ?? 'Archive';
    const foldersStr = folderTree.join('\n');

    const proposals: OrganizeVaultProposal[] = [];

    // Phase 1: Orphan notes → AI suggests folder placement
    if (orphans.length > 0) {
      const orphanChunks: NoteMetadataEntry[][] = [];
      for (let i = 0; i < orphans.length; i += REFACTOR_BATCH_SIZE) {
        orphanChunks.push([...orphans.slice(i, i + REFACTOR_BATCH_SIZE)]);
      }

      type AiPlacementResult = { index: number; suggestedFolder: string; confidence: number; rationale: string };
      type PlacementResult = { path: string; suggestedFolder: string; confidence: number; rationale: string };
      const allPlacements: PlacementResult[] = [];
      let lastReorgError: unknown;
      let aiSuccessCount = 0;

      for (let i = 0; i < orphanChunks.length; i++) {
        this.checkAborted(signal);
        onProgress({
          phase: 'analyzing',
          currentStep: i + 1,
          totalSteps: orphanChunks.length + (emptyNonOrphans.length > 0 ? 1 : 0),
          message: `Analyzing orphan batch ${i + 1}/${orphanChunks.length}...`,
        });

        const chunkNotes = orphanChunks[i];
        const chunkStr = await this.buildNoteChunkString(chunkNotes, privacyRules);

        try {
          const response = await this.ai.callCompletion({
            systemPrompt: REFACTOR_PROMPTS.noteReorganize.system,
            prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.noteReorganize.user(chunkStr, foldersStr),
            maxTokens: 8192,
            temperature: 0.3,
            jsonMode: true,
          });
          aiSuccessCount++;
          const rawParsed = tryParseJsonArray<AiPlacementResult>(response.content);
          const parsed: PlacementResult[] = rawParsed
            .filter(r => r.index >= 1 && r.index <= chunkNotes.length)
            .map(r => ({
              path: chunkNotes[r.index - 1].path,
              suggestedFolder: r.suggestedFolder,
              confidence: r.confidence,
              rationale: r.rationale,
            }));
          const expected = chunkNotes.length;
          if (parsed.length > 0) allPlacements.push(...parsed);

          // Retry missing notes from partial response
          if (parsed.length < expected && parsed.length > 0) {
            const returnedPaths = new Set(parsed.map(p => p.path));
            const missing = chunkNotes.filter(n => !returnedPaths.has(n.path));
            if (missing.length > 0) {
              this.checkAborted(signal);
              const retryStr = await this.buildNoteChunkString(missing, privacyRules);
              try {
                const retryResp = await this.ai.callCompletion({
                  systemPrompt: REFACTOR_PROMPTS.noteReorganize.system,
                  prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.noteReorganize.user(retryStr, foldersStr),
                  maxTokens: 8192,
                  temperature: 0.3,
                  jsonMode: true,
                });
                const retryRaw = tryParseJsonArray<AiPlacementResult>(retryResp.content);
                const retryParsed: PlacementResult[] = retryRaw
                  .filter(r => r.index >= 1 && r.index <= missing.length)
                  .map(r => ({
                    path: missing[r.index - 1].path,
                    suggestedFolder: r.suggestedFolder,
                    confidence: r.confidence,
                    rationale: r.rationale,
                  }));
                if (retryParsed.length > 0) allPlacements.push(...retryParsed);
              } catch (retryErr) {
                console.warn(`[Vaultend] Orphan chunk ${i + 1} retry failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
              }
            }
          }
        } catch (err) {
          lastReorgError = err;
          console.warn(`[Vaultend] Reorganize orphan chunk ${i + 1} failed:`, err instanceof Error ? err.message : err);
        }
      }

      if (aiSuccessCount === 0 && lastReorgError) throw lastReorgError;

      const lowConfCount = allPlacements.filter(p => p.confidence < REORG_LOW_CONFIDENCE_THRESHOLD).length;
      const lowConfRatio = allPlacements.length > 0 ? lowConfCount / allPlacements.length : 0;

      if (lowConfRatio >= REORG_TIER2_TRIGGER_RATIO) {
        this.checkAborted(signal);
        onProgress({
          phase: 'analyzing',
          currentStep: orphanChunks.length,
          totalSteps: orphanChunks.length,
          message: 'Low confidence detected — suggesting new folders...',
        });

        const lowConfNotes = allPlacements
          .filter(p => p.confidence < REORG_LOW_CONFIDENCE_THRESHOLD)
          .map(p => orphans.find(n => n.path === p.path))
          .filter((n): n is NoteMetadataEntry => n !== undefined);

        const lowConfStr = await this.buildNoteChunkString(lowConfNotes, privacyRules);

        try {
          const tier2Response = await this.ai.callCompletion({
            systemPrompt: REFACTOR_PROMPTS.noteReorganize.tier2System,
            prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.noteReorganize.tier2User(lowConfStr, foldersStr),
            maxTokens: 8192,
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

      proposals.push(...this.convertReorganizeProposals(allPlacements, noteEntries, folderTree));
    }

    // Phase 2: Empty notes with 0 backlinks → auto-archive (no AI needed)
    for (const empty of emptyNonOrphans) {
      proposals.push(createProposal({
        type: 'archive-empty',
        targetPath: createNotePath(empty.path),
        diffs: [{ field: 'folder', before: empty.folder || '/', after: archiveFolder }],
        affectedPaths: [createNotePath(empty.path)],
        confidence: 0.9,
        rationale: 'Empty note (no content after frontmatter) with no backlinks',
        metadata: { source: 'refactor', suggestedFolder: archiveFolder },
      }));
    }

    // Also archive orphan empty notes not already captured by AI placement
    const orphanEmptyPaths = new Set(
      orphans.filter(n => n.wordCount === 0).map(n => n.path),
    );
    const alreadyProposed = new Set(proposals.map(p => p.targetPath as string));
    for (const path of orphanEmptyPaths) {
      if (alreadyProposed.has(path)) continue;
      const entry = noteEntries.find(n => n.path === path);
      if (!entry) continue;
      proposals.push(createProposal({
        type: 'archive-empty',
        targetPath: createNotePath(path),
        diffs: [{ field: 'folder', before: entry.folder || '/', after: archiveFolder }],
        affectedPaths: [createNotePath(path)],
        confidence: 0.9,
        rationale: 'Empty orphan note — no content and no connections',
        metadata: { source: 'refactor', suggestedFolder: archiveFolder },
      }));
    }

    this.checkAborted(signal);
    onProgress({ phase: 'synthesizing', currentStep: 1, totalSteps: 1, message: 'Building proposals...' });

    return proposals;
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

      const fileName = note.path.split('/').pop() ?? note.path;
      const idx = lines.length + 1;
      lines.push(
        `[${idx}] File: ${fileName}\nTags: ${note.tags.join(', ') || '(none)'}\nPreview: ${preview}`,
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
    let sameFolderCount = 0;
    let lowConfCount = 0;
    let notFoundCount = 0;

    for (const placement of placements) {
      const entry = noteEntries.find(n => n.path === placement.path);
      if (!entry) { notFoundCount++; continue; }

      const currentFolder = entry.folder || '/';
      if (placement.suggestedFolder === currentFolder) { sameFolderCount++; continue; }
      if (placement.confidence < 0.3) { lowConfCount++; continue; }

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

    const sameFolderDetails = new Map<string, number>();
    for (const placement of placements) {
      const entry = noteEntries.find(n => n.path === placement.path);
      if (entry && placement.suggestedFolder === (entry.folder || '/')) {
        const folder = entry.folder || '/';
        sameFolderDetails.set(folder, (sameFolderDetails.get(folder) ?? 0) + 1);
      }
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

    const proposals: OrganizeVaultProposal[] = [];

    // Phase 1: Orphan link suggestions (AI-powered)
    if (orphans.length > 0) {
      const orphanProposals = await this.suggestLinksForOrphans(orphans, signal, onProgress);
      proposals.push(...orphanProposals);
    }

    // Phase 2: Broken link detection and fix proposals
    const brokenLinkProposals = await this.detectAndFixBrokenLinks(snapshot, signal, onProgress);
    proposals.push(...brokenLinkProposals);

    return proposals;
  }

  private async suggestLinksForOrphans(
    orphans: ReadonlyArray<NoteMetadataEntry>,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const prefCtx = this.preference ? await this.preference.getPreferenceContext('refactor') : '';
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const proposals: OrganizeVaultProposal[] = [];
    let lastLinkError: unknown;
    let linkAiSuccessCount = 0;

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
            prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.linkSuggest.user(orphanStr, candidateDescriptions.join('\n')),
            maxTokens: 500,
            temperature: 0.2,
            jsonMode: true,
          });
          linkAiSuccessCount++;

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
          lastLinkError = err;
          console.warn(`[Vaultend] Link suggestion failed for ${orphan.path}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (linkAiSuccessCount === 0 && lastLinkError) throw lastLinkError;
    return proposals;
  }

  private async detectAndFixBrokenLinks(
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const notePathSet = new Set(snapshot.noteEntries.map(n => n.path));
    const basenameSet = new Map<string, string>();
    for (const entry of snapshot.noteEntries) {
      const basename = entry.path.split('/').pop()?.replace('.md', '') ?? '';
      basenameSet.set(basename.toLowerCase(), entry.path);
    }

    type BrokenLinkEntry = { sourcePath: string; brokenTarget: string; lineNumber: number };
    const brokenLinks: BrokenLinkEntry[] = [];
    const WIKI_LINK_RE = /\[\[([^\]|#^]+)(?:[#|^][^\]]*)?]]/g;

    for (const entry of snapshot.noteEntries) {
      if (brokenLinks.length >= 200) break;
      const note = await this.vault.readNote(createNotePath(entry.path));
      if (!note) continue;

      const lines = note.content.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        let match: RegExpExecArray | null;
        WIKI_LINK_RE.lastIndex = 0;
        while ((match = WIKI_LINK_RE.exec(line)) !== null) {
          const target = match[1].trim();
          if (!target) continue;

          const targetWithExt = target.endsWith('.md') ? target : `${target}.md`;
          const targetLower = target.toLowerCase();

          const exists =
            notePathSet.has(targetWithExt) ||
            notePathSet.has(target) ||
            basenameSet.has(targetLower);

          if (!exists) {
            brokenLinks.push({
              sourcePath: entry.path,
              brokenTarget: target,
              lineNumber: lineIdx + 1,
            });
          }
        }
      }
    }

    if (brokenLinks.length === 0) return [];

    this.checkAborted(signal);
    onProgress({
      phase: 'analyzing',
      currentStep: 1,
      totalSteps: 1,
      message: `Fixing ${brokenLinks.length} broken links...`,
    });

    const proposals: OrganizeVaultProposal[] = [];
    const BROKEN_LINK_BATCH = 20;

    for (let i = 0; i < brokenLinks.length; i += BROKEN_LINK_BATCH) {
      this.checkAborted(signal);
      const batch = brokenLinks.slice(i, i + BROKEN_LINK_BATCH);

      for (const bl of batch) {
        const candidates = await this.searchIndex.search(bl.brokenTarget, 5);
        const BROKEN_LINK_SCORE_THRESHOLD = 0.4;

        if (candidates.length === 0 || (candidates[0].score ?? 0) < BROKEN_LINK_SCORE_THRESHOLD) {
          proposals.push(createProposal({
            type: 'fix-broken-link',
            targetPath: createNotePath(bl.sourcePath),
            diffs: [{
              field: 'link',
              before: `[[${bl.brokenTarget}]]`,
              after: '(remove link)',
            }],
            affectedPaths: [createNotePath(bl.sourcePath)],
            confidence: 0.7,
            rationale: `Link target "${bl.brokenTarget}" does not exist and no similar note found`,
            metadata: { source: 'refactor', brokenLink: bl.brokenTarget, action: 'remove', lineNumber: bl.lineNumber },
          }));
          continue;
        }

        const bestMatch = candidates[0];
        const bestBasename = (bestMatch.notePath as string).split('/').pop()?.replace('.md', '') ?? '';

        proposals.push(createProposal({
          type: 'fix-broken-link',
          targetPath: createNotePath(bl.sourcePath),
          diffs: [{
            field: 'link',
            before: `[[${bl.brokenTarget}]]`,
            after: `[[${bestBasename}]]`,
          }],
          affectedPaths: [createNotePath(bl.sourcePath), bestMatch.notePath],
          confidence: clamp(bestMatch.score ?? 0.6),
          rationale: `Broken link likely refers to "${bestBasename}" (search match)`,
          metadata: {
            source: 'refactor',
            brokenLink: bl.brokenTarget,
            suggestedTarget: bestMatch.notePath as string,
            action: 'replace',
            lineNumber: bl.lineNumber,
          },
        }));
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

    const prefCtx = this.preference ? await this.preference.getPreferenceContext('refactor') : '';

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
    let lastFleetingError: unknown;
    let fleetingAiSuccessCount = 0;

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
          prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.fleetingConsolidate.user(clusterStr),
          maxTokens: 4000,
          temperature: 0.2,
          jsonMode: true,
        });
        fleetingAiSuccessCount++;

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
        lastFleetingError = err;
        console.warn(`[Vaultend] Fleeting cluster ${i + 1} merge failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (fleetingAiSuccessCount === 0 && lastFleetingError) throw lastFleetingError;
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

  // ─── Misplaced Note Detection ───

  private async analyzeMisplacedNotes(
    goal: RefactorGoal,
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const affinityThreshold = goal.parameters.misplacedAffinityThreshold ?? MISPLACED_AFFINITY_THRESHOLD;

    const connectedNotes = snapshot.noteEntries.filter(
      n => n.links.length > 0 || n.backlinks.length > 0,
    );

    if (connectedNotes.length === 0) return [];

    onProgress({ phase: 'analyzing', currentStep: 0, totalSteps: 3, message: 'Computing folder affinity...' });

    const folderNotes = new Map<string, NoteMetadataEntry[]>();
    for (const note of snapshot.noteEntries) {
      if (!note.folder) continue;
      const list = folderNotes.get(note.folder) ?? [];
      list.push(note);
      folderNotes.set(note.folder, list);
    }

    const folderTags = new Map<string, Set<string>>();
    for (const [folder, notes] of folderNotes) {
      const tags = new Set<string>();
      for (const n of notes) {
        for (const t of n.tags) tags.add(t);
      }
      folderTags.set(folder, tags);
    }

    const misplacedCandidates: Array<{ note: NoteMetadataEntry; bestFolder: string; affinity: number }> = [];

    for (const note of connectedNotes) {
      if (!note.folder) continue;
      const currentFolderNotes = folderNotes.get(note.folder) ?? [];
      if (currentFolderNotes.length <= 1) continue;

      const currentAffinity = this.computeFolderAffinity(note, note.folder, folderNotes);

      if (currentAffinity >= affinityThreshold) continue;

      let bestFolder = note.folder;
      let bestAffinity = currentAffinity;

      for (const folder of snapshot.folderTree) {
        if (folder === note.folder) continue;
        const aff = this.computeFolderAffinity(note, folder, folderNotes);
        if (aff > bestAffinity) {
          bestAffinity = aff;
          bestFolder = folder;
        }
      }

      if (bestFolder !== note.folder && bestAffinity > currentAffinity + 0.15) {
        misplacedCandidates.push({ note, bestFolder, affinity: bestAffinity });
      }
    }

    this.checkAborted(signal);

    if (misplacedCandidates.length === 0) return [];

    onProgress({ phase: 'analyzing', currentStep: 1, totalSteps: 3, message: `Found ${misplacedCandidates.length} candidates. Sending to AI...` });

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const proposals: OrganizeVaultProposal[] = [];
    const chunks = this.chunkArray(misplacedCandidates, MISPLACED_BATCH_SIZE);
    const knownTags = snapshot.tagFrequencies.slice(0, REFACTOR_MAX_TAGS_IN_PROMPT).map(t => t.tag).join(', ');

    for (let i = 0; i < chunks.length; i++) {
      this.checkAborted(signal);
      onProgress({ phase: 'analyzing', currentStep: 2, totalSteps: 3, message: `AI batch ${i + 1}/${chunks.length}...` });

      const chunk = chunks[i];
      const noteChunkStr = await this.buildMisplacedChunkString(chunk, privacyRules);
      const foldersStr = snapshot.folderTree.join('\n');

      const response = await this.ai.callCompletion({
        systemPrompt: REFACTOR_PROMPTS.misplacedDetect.system,
        prompt: REFACTOR_PROMPTS.misplacedDetect.user(noteChunkStr, foldersStr, knownTags),
        maxTokens: 4096,
        temperature: 0.3,
        jsonMode: true,
      });

      type AiMisplacedResult = {
        index: number;
        isMisplaced: boolean;
        suggestedFolder: string;
        suggestedTags?: string[];
        suggestedLinks?: string[];
        confidence: number;
        rationale: string;
      };

      const parsed = tryParseJsonArray<AiMisplacedResult>(response.content);

      for (const r of parsed) {
        if (!r.isMisplaced || r.index < 1 || r.index > chunk.length) continue;
        const candidate = chunk[r.index - 1];
        const diffs: ProposalDiff[] = [
          { field: 'folder', before: candidate.note.folder, after: r.suggestedFolder },
        ];
        if (r.suggestedTags && r.suggestedTags.length > 0) {
          const newTags = r.suggestedTags.filter(t => !candidate.note.tags.includes(t));
          if (newTags.length > 0) {
            diffs.push({ field: 'tags', before: candidate.note.tags.join(', '), after: [...candidate.note.tags, ...newTags].join(', ') });
          }
        }
        if (r.suggestedLinks && r.suggestedLinks.length > 0) {
          const newLinks = r.suggestedLinks.filter(l => !candidate.note.links.includes(l));
          if (newLinks.length > 0) {
            diffs.push({ field: 'links', before: '', after: newLinks.join(', ') });
          }
        }

        proposals.push(createProposal({
          type: 'misplaced-reposition',
          targetPath: createNotePath(candidate.note.path),
          diffs,
          affectedPaths: [createNotePath(candidate.note.path)],
          confidence: clamp(r.confidence),
          rationale: r.rationale,
          metadata: {
            source: 'refactor',
            currentFolder: candidate.note.folder,
            suggestedFolder: r.suggestedFolder,
            suggestedTags: r.suggestedTags ?? [],
            suggestedLinks: r.suggestedLinks ?? [],
            affinityScore: candidate.affinity,
          },
        }));
      }
    }

    onProgress({ phase: 'analyzing', currentStep: 3, totalSteps: 3, message: `${proposals.length} misplaced notes confirmed` });
    return proposals;
  }

  private computeFolderAffinity(
    note: NoteMetadataEntry,
    targetFolder: string,
    folderNotes: Map<string, NoteMetadataEntry[]>,
  ): number {
    const folderMembers = folderNotes.get(targetFolder) ?? [];
    if (folderMembers.length === 0) return 0;

    const otherMembers = folderMembers.filter(n => n.path !== note.path);
    if (otherMembers.length === 0) return 0;

    let linkScore = 0;
    const allLinks = [...note.links, ...note.backlinks];
    if (allLinks.length > 0) {
      const folderPaths = new Set(otherMembers.map(n => n.path));
      const linksToFolder = allLinks.filter(l => folderPaths.has(l)).length;
      linkScore = linksToFolder / allLinks.length;
    }

    let tagScore = 0;
    if (note.tags.length > 0) {
      const folderTagSet = new Set<string>();
      for (const m of otherMembers) {
        for (const t of m.tags) folderTagSet.add(t);
      }
      const sharedTags = note.tags.filter(t => folderTagSet.has(t)).length;
      tagScore = sharedTags / note.tags.length;
    }

    return linkScore * 0.6 + tagScore * 0.4;
  }

  private async buildMisplacedChunkString(
    candidates: Array<{ note: NoteMetadataEntry; bestFolder: string; affinity: number }>,
    privacyRules: PrivacyRule[],
  ): Promise<string> {
    const lines: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const { note } = candidates[i];
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      const rawContent = fullNote?.content ?? '';
      const preview = applyContentRedaction(
        rawContent.slice(0, REFACTOR_CONTENT_PREVIEW),
        privacyRules,
      );
      lines.push(
        `[${i + 1}] File: ${note.path.split('/').pop()}\nCurrent Folder: ${note.folder}\nTags: ${note.tags.join(', ') || '(none)'}\nLinks: ${note.links.join(', ') || '(none)'}\nBacklinks: ${note.backlinks.join(', ') || '(none)'}\nPreview: ${preview}`,
      );
    }
    return lines.join('\n---\n');
  }

  // ─── Folder Structure Optimization ───

  private async analyzeFolderOptimization(
    goal: RefactorGoal,
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const bloatedThreshold = goal.parameters.bloatedFolderThreshold ?? BLOATED_FOLDER_THRESHOLD;
    const thinThreshold = goal.parameters.thinFolderThreshold ?? THIN_FOLDER_THRESHOLD;

    const folderCounts = new Map<string, NoteMetadataEntry[]>();
    for (const note of snapshot.noteEntries) {
      if (!note.folder) continue;
      const list = folderCounts.get(note.folder) ?? [];
      list.push(note);
      folderCounts.set(note.folder, list);
    }

    const proposals: OrganizeVaultProposal[] = [];

    // Phase 1: Bloated folder detection
    const bloatedFolders = [...folderCounts.entries()].filter(([, notes]) => notes.length > bloatedThreshold);
    const thinFolders = [...folderCounts.entries()].filter(([, notes]) => notes.length > 0 && notes.length < thinThreshold);

    const totalSteps = bloatedFolders.length + (thinFolders.length > 1 ? 1 : 0);

    onProgress({ phase: 'analyzing', currentStep: 0, totalSteps, message: `Analyzing ${bloatedFolders.length} bloated, ${thinFolders.length} thin folders...` });

    for (let fi = 0; fi < bloatedFolders.length; fi++) {
      this.checkAborted(signal);
      const [folder, notes] = bloatedFolders[fi];
      onProgress({ phase: 'analyzing', currentStep: fi, totalSteps, message: `Clustering "${folder}" (${notes.length} notes)...` });

      const clusters = await this.clusterNotesByContent(notes);
      if (clusters.length < 2) continue;

      const existingSubfolders = snapshot.folderTree
        .filter(f => f.startsWith(folder + '/') && f.split('/').length === folder.split('/').length + 1)
        .join(', ');

      const clustersStr = clusters.map((c, idx) =>
        `Cluster ${idx}: ${c.length} notes\n  ${c.map(n => n.path.split('/').pop()).join(', ')}`,
      ).join('\n');

      const response = await this.ai.callCompletion({
        systemPrompt: REFACTOR_PROMPTS.folderOptimize.splitSystem,
        prompt: REFACTOR_PROMPTS.folderOptimize.splitUser(folder, clustersStr, existingSubfolders || '(none)'),
        maxTokens: 2048,
        temperature: 0.3,
        jsonMode: true,
      });

      type AiSplitResult = { splits: Array<{ clusterIndex: number; suggestedName: string; confidence: number; rationale: string }> };
      try {
        const parsed: AiSplitResult = JSON.parse(response.content);
        if (parsed.splits && parsed.splits.length > 0) {
          const suggestedSubfolders = parsed.splits
            .filter(s => s.clusterIndex >= 0 && s.clusterIndex < clusters.length)
            .map(s => ({
              name: `${folder}/${s.suggestedName}`,
              noteCount: clusters[s.clusterIndex].length,
              notes: clusters[s.clusterIndex].map(n => n.path),
            }));

          if (suggestedSubfolders.length >= 2) {
            const avgConfidence = parsed.splits.reduce((sum, s) => sum + s.confidence, 0) / parsed.splits.length;
            proposals.push(createProposal({
              type: 'split-folder',
              targetPath: createNotePath(notes[0].path),
              diffs: suggestedSubfolders.map(sf => ({
                field: 'new-subfolder',
                before: folder,
                after: `${sf.name} (${sf.noteCount} notes)`,
              })),
              affectedPaths: notes.map(n => createNotePath(n.path)),
              confidence: clamp(avgConfidence),
              rationale: parsed.splits.map(s => s.rationale).join('; '),
              metadata: {
                source: 'refactor',
                sourceFolder: folder,
                suggestedSubfolders,
              },
            }));
          }
        }
      } catch { /* invalid AI response, skip */ }
    }

    // Phase 2: Thin folder merge detection
    if (thinFolders.length > 1) {
      this.checkAborted(signal);
      onProgress({ phase: 'analyzing', currentStep: totalSteps - 1, totalSteps, message: 'Analyzing thin folder merge candidates...' });

      const mergeCandidates: Array<{ folderA: string; folderB: string; overlap: number }> = [];

      for (let i = 0; i < thinFolders.length; i++) {
        for (let j = i + 1; j < thinFolders.length; j++) {
          const [folderA, notesA] = thinFolders[i];
          const [folderB, notesB] = thinFolders[j];

          const parentA = folderA.includes('/') ? folderA.substring(0, folderA.lastIndexOf('/')) : '';
          const parentB = folderB.includes('/') ? folderB.substring(0, folderB.lastIndexOf('/')) : '';
          if (parentA !== parentB) continue;

          const tagsA = new Set(notesA.flatMap(n => n.tags));
          const tagsB = new Set(notesB.flatMap(n => n.tags));
          const intersection = [...tagsA].filter(t => tagsB.has(t)).length;
          const union = new Set([...tagsA, ...tagsB]).size;
          const overlap = union > 0 ? intersection / union : 0;

          if (overlap > 0.2) {
            mergeCandidates.push({ folderA, folderB, overlap });
          }
        }
      }

      if (mergeCandidates.length > 0) {
        const candidatesStr = mergeCandidates.map((c, idx) =>
          `Pair ${idx}: "${c.folderA}" (${folderCounts.get(c.folderA)?.length ?? 0} notes) + "${c.folderB}" (${folderCounts.get(c.folderB)?.length ?? 0} notes) — tag overlap: ${(c.overlap * 100).toFixed(0)}%`,
        ).join('\n');

        const response = await this.ai.callCompletion({
          systemPrompt: REFACTOR_PROMPTS.folderOptimize.mergeSystem,
          prompt: REFACTOR_PROMPTS.folderOptimize.mergeUser(candidatesStr),
          maxTokens: 2048,
          temperature: 0.3,
          jsonMode: true,
        });

        type AiMergeResult = { merges: Array<{ pairIndex: number; shouldMerge: boolean; suggestedName: string; confidence: number; rationale: string }> };
        try {
          const parsed: AiMergeResult = JSON.parse(response.content);
          if (parsed.merges) {
            for (const m of parsed.merges) {
              if (!m.shouldMerge || m.pairIndex < 0 || m.pairIndex >= mergeCandidates.length) continue;
              const pair = mergeCandidates[m.pairIndex];
              const allNotes = [...(folderCounts.get(pair.folderA) ?? []), ...(folderCounts.get(pair.folderB) ?? [])];

              proposals.push(createProposal({
                type: 'merge-folders',
                targetPath: createNotePath(allNotes[0]?.path ?? pair.folderA + '/placeholder.md'),
                diffs: [
                  { field: 'merge', before: `${pair.folderA} + ${pair.folderB}`, after: m.suggestedName },
                ],
                affectedPaths: allNotes.map(n => createNotePath(n.path)),
                confidence: clamp(m.confidence),
                rationale: m.rationale,
                metadata: {
                  source: 'refactor',
                  folders: [pair.folderA, pair.folderB],
                  suggestedMergedFolder: m.suggestedName,
                  totalNoteCount: allNotes.length,
                },
              }));
            }
          }
        } catch { /* invalid AI response, skip */ }
      }
    }

    return proposals;
  }

  private async clusterNotesByContent(notes: NoteMetadataEntry[]): Promise<NoteMetadataEntry[][]> {
    if (notes.length < 4) return [notes];

    const corpus = new TfIdfCorpus();
    const tokensByNote: string[][] = [];
    for (const note of notes) {
      const filename = note.path.split('/').pop() ?? '';
      const linkTargets = note.links.map(l => (l.split('/').pop() ?? '').replace(/\.md$/, ''));
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      const contentPreview = (fullNote?.content ?? '').slice(0, 200);

      const tokens = [filename, ...note.tags, ...linkTargets, contentPreview]
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter(t => t.length > 2);
      tokensByNote.push(tokens);
      corpus.addDocument(note.path, tokens);
    }

    const vectors = notes.map((_, idx) => corpus.computeTfIdfVector(tokensByNote[idx]));

    const assigned = new Set<number>();
    const clusters: NoteMetadataEntry[][] = [];
    const SIMILARITY_THRESHOLD = 0.2;

    for (let i = 0; i < notes.length; i++) {
      if (assigned.has(i)) continue;
      const cluster: NoteMetadataEntry[] = [notes[i]];
      assigned.add(i);

      for (let j = i + 1; j < notes.length; j++) {
        if (assigned.has(j)) continue;
        const sim = corpus.cosineSimilarity(vectors[i], vectors[j]);
        if (sim >= SIMILARITY_THRESHOLD) {
          cluster.push(notes[j]);
          assigned.add(j);
        }
      }
      clusters.push(cluster);
    }

    return clusters.filter(c => c.length >= 2);
  }

  // ─── Fleeting Promotion ───

  private async analyzeFleetingPromotion(
    goal: RefactorGoal,
    snapshot: VaultMetadataSnapshot,
    signal: AbortSignal,
    onProgress: (p: RefactorProgress) => void,
  ): Promise<OrganizeVaultProposal[]> {
    const fleetingFolders = goal.parameters.fleetingFolders ?? DEFAULT_FLEETING_FOLDERS;
    const maturityAgeDays = goal.parameters.maturityAgeDays ?? PROMOTE_MATURITY_AGE_DAYS;
    const maturityMinWordCount = goal.parameters.maturityMinWordCount ?? PROMOTE_MIN_WORD_COUNT;

    const now = this.clock.now();
    const maturityAgeMs = maturityAgeDays * 24 * 60 * 60 * 1000;

    const fleetingSet = new Set(fleetingFolders.map(f => f.toLowerCase()));
    const matureNotes = snapshot.noteEntries.filter(note => {
      if (!note.folder) return false;
      const folderLower = note.folder.toLowerCase();
      const isInFleeting = [...fleetingSet].some(f => folderLower === f || folderLower.startsWith(f + '/'));
      if (!isInFleeting) return false;

      const age = now - note.createdAt;
      return age >= maturityAgeMs
        && note.wordCount >= maturityMinWordCount
        && note.tags.length > 0
        && (note.links.length > 0 || note.backlinks.length > 0);
    });

    if (matureNotes.length === 0) return [];

    onProgress({ phase: 'analyzing', currentStep: 0, totalSteps: 2, message: `Found ${matureNotes.length} mature fleeting notes. Sending to AI...` });

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const proposals: OrganizeVaultProposal[] = [];
    const chunks = this.chunkArray(matureNotes, REFACTOR_BATCH_SIZE);
    const foldersStr = snapshot.folderTree
      .filter(f => !fleetingSet.has(f.toLowerCase()))
      .join('\n');

    for (let i = 0; i < chunks.length; i++) {
      this.checkAborted(signal);
      onProgress({ phase: 'analyzing', currentStep: 1, totalSteps: 2, message: `AI batch ${i + 1}/${chunks.length}...` });

      const chunk = chunks[i];
      const noteChunkStr = await this.buildPromoteChunkString(chunk, privacyRules);

      const response = await this.ai.callCompletion({
        systemPrompt: REFACTOR_PROMPTS.fleetingPromote.system,
        prompt: REFACTOR_PROMPTS.fleetingPromote.user(noteChunkStr, foldersStr),
        maxTokens: 4096,
        temperature: 0.3,
        jsonMode: true,
      });

      type AiPromoteResult = {
        index: number;
        suggestedFolder: string;
        isNewFolder: boolean;
        confidence: number;
        rationale: string;
      };

      const parsed = tryParseJsonArray<AiPromoteResult>(response.content);

      for (const r of parsed) {
        if (r.index < 1 || r.index > chunk.length) continue;
        const note = chunk[r.index - 1];
        const ageDays = Math.floor((now - note.createdAt) / (24 * 60 * 60 * 1000));

        proposals.push(createProposal({
          type: 'promote-note',
          targetPath: createNotePath(note.path),
          diffs: [
            { field: 'folder', before: note.folder, after: r.suggestedFolder },
          ],
          affectedPaths: [createNotePath(note.path)],
          confidence: clamp(r.confidence),
          rationale: r.rationale,
          metadata: {
            source: 'refactor',
            currentFolder: note.folder,
            suggestedFolder: r.suggestedFolder,
            isNewFolder: r.isNewFolder,
            maturitySignals: {
              ageDays,
              wordCount: note.wordCount,
              tagCount: note.tags.length,
              linkCount: note.links.length + note.backlinks.length,
            },
          },
        }));
      }
    }

    onProgress({ phase: 'analyzing', currentStep: 2, totalSteps: 2, message: `${proposals.length} notes ready for promotion` });
    return proposals;
  }

  private async buildPromoteChunkString(
    notes: NoteMetadataEntry[],
    privacyRules: PrivacyRule[],
  ): Promise<string> {
    const lines: string[] = [];
    const now = this.clock.now();
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const fullNote = await this.vault.readNote(createNotePath(note.path));
      const rawContent = fullNote?.content ?? '';
      const preview = applyContentRedaction(
        rawContent.slice(0, REFACTOR_CONTENT_PREVIEW),
        privacyRules,
      );
      const ageDays = Math.floor((now - note.createdAt) / (24 * 60 * 60 * 1000));
      lines.push(
        `[${i + 1}] File: ${note.path.split('/').pop()}\nFolder: ${note.folder}\nAge: ${ageDays} days\nWords: ${note.wordCount}\nTags: ${note.tags.join(', ')}\nLinks: ${note.links.join(', ') || '(none)'}\nBacklinks: ${note.backlinks.join(', ') || '(none)'}\nPreview: ${preview}`,
      );
    }
    return lines.join('\n---\n');
  }

  // ─── Shared ───

  private chunkArray<T>(arr: T[] | ReadonlyArray<T>, size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size) as T[]);
    }
    return chunks;
  }

  private checkAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('Refactor cancelled by user', 'AbortError');
    }
  }

  private async filterSuppressed(
    proposals: OrganizeVaultProposal[],
    now: number,
  ): Promise<OrganizeVaultProposal[]> {
    if (!this.preference) return proposals;
    const suppressed = await this.preference.getSuppressedFingerprints(now);
    if (suppressed.length === 0) return proposals;
    const suppressedSet = new Set(suppressed);
    return proposals.filter(p => !suppressedSet.has(PreferenceExtractor.computeProposalFingerprint(p)));
  }
}

function clamp(confidence: number): number {
  return Math.max(0.3, Math.min(0.95, confidence));
}

function tryParseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Mid-object truncation: find last complete element via `},` or trailing `}`
    const lastComplete = raw.lastIndexOf('},');
    if (lastComplete > 0) {
      const trimmed = raw.substring(0, lastComplete + 1) + ']';
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch { /* fall through */ }
    }
    // Trailing comma between elements: `[{...},{...},` → close array
    const repaired = raw.replace(/,\s*$/, '') + ']';
    try {
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
