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

    console.log(`[Vaultend:refactor] collectMetadata: raw=${noteEntries.length}, afterPrivacy=${filtered.length}, privacyRules=${privacyRules.length}`);
    if (privacyRules.length > 0) {
      console.log(`[Vaultend:refactor]   rules:`, privacyRules.map(r => ({ type: r.type, patternLen: r.pattern.length, enabled: r.enabled })));
    }
    if (filtered.length < noteEntries.length) {
      const excluded = noteEntries.filter(n => !isNoteAllowedByRules(n.path, n.tags, [], privacyRules));
      console.log(`[Vaultend:refactor]   excluded samples:`, excluded.slice(0, 3).map(n => n.path));
    }

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
          maxTokens: 4096,
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

        const chunkStr = await this.buildNoteChunkString(orphanChunks[i], privacyRules);

        try {
          const response = await this.ai.callCompletion({
            systemPrompt: REFACTOR_PROMPTS.noteReorganize.system,
            prompt: (prefCtx ? prefCtx + '\n\n' : '') + REFACTOR_PROMPTS.noteReorganize.user(chunkStr, foldersStr),
            maxTokens: 4096,
            temperature: 0.3,
            jsonMode: true,
          });
          aiSuccessCount++;
          const parsed = JSON.parse(response.content) as PlacementResult[];
          if (Array.isArray(parsed)) allPlacements.push(...parsed);
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
            maxTokens: 4096,
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
