import {
  OrganizeVaultPlan,
  OrganizeVaultProposal,
  createOrganizeVaultPlan,
  createProposal,
  ProposalDiff,
} from '../../domain/models/OrganizeVaultPlan';
import {
  MaintenancePlan,
  OrphanNoteEntry,
  BrokenLink,
  DuplicateTagGroup,
  DuplicatePair,
  MissingTagSuggestion,
  EmptyNoteEntry,
} from '../../domain/models/OrganizeModels';
import { applyContentRedaction, isNoteAllowedByRules } from '../../domain/models/PrivacyRule';
import { ClockPort } from '../ports/ClockPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { OrganizeVaultPort } from '../ports/OrganizeVaultPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import { ConfigPort } from '../ports/ConfigPort';
import type { PreferencePort } from '../ports/PreferencePort';
import { PreferenceExtractor } from '../../domain/services/PreferenceExtractor';

const AI_BATCH_SIZE = 10;
const MERGE_BATCH_SIZE = 3;
const CONTENT_PREVIEW_LENGTH = 500;
const MERGE_CONTENT_MAX_LENGTH = 3000;
const BROKEN_LINK_SEARCH_LIMIT = 5;
const BROKEN_LINK_FALLBACK_SCORE = 0.4;

export class GenerateOrganizeVaultUseCase {
  constructor(
    private readonly clock: ClockPort,
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly store: OrganizeVaultPort,
    private readonly ai: AIProviderPort,
    private readonly config: ConfigPort,
    private readonly preference?: PreferencePort,
  ) {}

  async execute(plan: MaintenancePlan): Promise<OrganizeVaultPlan> {
    const proposals: OrganizeVaultProposal[] = [];
    const folders = await this.vault.listFolders();

    proposals.push(...await this.generateOrphanProposals(plan.orphanNotes, folders));
    proposals.push(...await this.generateBrokenLinkProposals(plan.brokenLinks));
    proposals.push(...this.generateDuplicateTagProposals(plan.duplicateTags));
    proposals.push(...await this.generateMissingTagProposals(plan.missingTags));
    proposals.push(...this.generateEmptyNoteProposals(plan.emptyNotes));
    proposals.push(...await this.generateMergeProposals(plan.duplicateCandidates));

    const now = this.clock.now();
    const filtered = await this.filterSuppressed(proposals, now);
    const result = createOrganizeVaultPlan(filtered, now);
    await this.store.save(result);
    return result;
  }

  private async generateOrphanProposals(
    orphans: ReadonlyArray<OrphanNoteEntry>,
    folders: ReadonlyArray<string>,
  ): Promise<OrganizeVaultProposal[]> {
    if (orphans.length === 0) return [];

    const results: OrganizeVaultProposal[] = [];

    for (let i = 0; i < orphans.length; i += AI_BATCH_SIZE) {
      const batch = orphans.slice(i, i + AI_BATCH_SIZE);
      const batchResults = await this.analyzeOrphanBatch(batch, folders);
      results.push(...batchResults);
    }

    return results;
  }

  private async analyzeOrphanBatch(
    orphans: ReadonlyArray<OrphanNoteEntry>,
    folders: ReadonlyArray<string>,
  ): Promise<OrganizeVaultProposal[]> {
    const noteData: Array<{ orphan: OrphanNoteEntry; content: string; currentFolder: string }> = [];

    for (const orphan of orphans) {
      const note = await this.vault.readNote(orphan.notePath);
      if (!note) continue;
      const pathStr = orphan.notePath as string;
      const lastSlash = pathStr.lastIndexOf('/');
      noteData.push({
        orphan,
        content: note.content.substring(0, CONTENT_PREVIEW_LENGTH),
        currentFolder: lastSlash > 0 ? pathStr.substring(0, lastSlash) : '/',
      });
    }

    if (noteData.length === 0) return [];

    try {
      const settings = await this.config.getSettings();
      const knownTags = settings.knownTags ?? [];

      const noteList = noteData.map((n, idx) =>
        `[${idx + 1}] Path: ${n.orphan.notePath as string}\nContent: ${n.content}`,
      ).join('\n---\n');

      const prefCtx = this.preference ? await this.preference.getPreferenceContext('organize') : '';
      const response = await this.ai.callCompletion({
        systemPrompt: 'You are a vault organizer. Analyze orphan notes and suggest the best folder, tags, and rationale for each. Respond ONLY with a JSON array.',
        prompt: `${prefCtx ? prefCtx + '\n\n' : ''}These notes have no links to or from other notes. For each, suggest where it belongs.

Available folders: ${folders.slice(0, 50).join(', ')}
${knownTags.length > 0 ? `Existing vault tags (prefer these over inventing new ones): ${knownTags.slice(0, 50).join(', ')}` : ''}

Notes:
${noteList}

Return a JSON array where each element has:
- "index": note number (1-based)
- "folder": best existing folder to move to, or current folder if it's fine
- "tags": array of suggested tags (max 3, MUST use tags from the existing vault tags list above when applicable)
- "confidence": 0.0-1.0 how certain you are
- "rationale": one-sentence explanation`,
        maxTokens: 1500,
        temperature: 0.3,
        jsonMode: true,
      });

      const suggestions = JSON.parse(response.content) as Array<{
        index: number;
        folder: string;
        tags: string[];
        confidence: number;
        rationale: string;
      }>;

      return noteData.map((n, idx) => {
        const suggestion = suggestions.find(s => s.index === idx + 1);
        if (suggestion && suggestion.folder !== n.currentFolder) {
          const diffs: ProposalDiff[] = [
            { field: 'folder', before: n.currentFolder, after: suggestion.folder },
          ];
          if (suggestion.tags.length > 0) {
            diffs.push({ field: 'tags', before: '(none)', after: suggestion.tags.join(', ') });
          }
          return createProposal({
            type: 'reposition',
            targetPath: n.orphan.notePath,
            diffs,
            affectedPaths: [n.orphan.notePath],
            confidence: Math.max(0.3, Math.min(0.95, suggestion.confidence)),
            rationale: suggestion.rationale,
          });
        }
        return createProposal({
          type: 'reposition',
          targetPath: n.orphan.notePath,
          diffs: [{ field: 'status', before: 'orphan (no links)', after: 'needs review' }],
          affectedPaths: [n.orphan.notePath],
          confidence: 0.5,
          rationale: suggestion?.rationale ?? `No backlinks found. File size: ${n.orphan.fileSize} bytes.`,
        });
      });
    } catch {
      return noteData.map(n => createProposal({
        type: 'reposition',
        targetPath: n.orphan.notePath,
        diffs: [{ field: 'status', before: 'orphan (no links)', after: 'archive' }],
        affectedPaths: [n.orphan.notePath],
        confidence: 0.6,
        rationale: `No backlinks found. File size: ${n.orphan.fileSize} bytes.`,
      }));
    }
  }

  private async generateBrokenLinkProposals(
    brokenLinks: ReadonlyArray<BrokenLink>,
  ): Promise<OrganizeVaultProposal[]> {
    if (brokenLinks.length === 0) return [];

    const results: OrganizeVaultProposal[] = [];
    for (let i = 0; i < brokenLinks.length; i += AI_BATCH_SIZE) {
      const batch = brokenLinks.slice(i, i + AI_BATCH_SIZE);
      const batchResults = await this.analyzeBrokenLinkBatch(batch);
      results.push(...batchResults);
    }
    return results;
  }

  private async analyzeBrokenLinkBatch(
    brokenLinks: ReadonlyArray<BrokenLink>,
  ): Promise<OrganizeVaultProposal[]> {
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    const linkData: Array<{
      link: BrokenLink;
      candidatePaths: string[];
      candidateScores: number[];
      descriptions: string[];
    }> = [];

    for (const link of brokenLinks) {
      const candidates = await this.searchIndex.search(link.targetLink, BROKEN_LINK_SEARCH_LIMIT);
      const descriptions: string[] = [];
      const paths: string[] = [];
      const scores: number[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const candidateNote = await this.vault.readNote(c.notePath);
        const preview = candidateNote
          ? applyContentRedaction(
              candidateNote.content.substring(0, 150).replace(/\n/g, ' '),
              privacyRules,
            )
          : '';
        const scorePercent = Math.round(c.score * 100);
        descriptions.push(`${i + 1}. ${c.notePath as string} (relevance: ${scorePercent}%)${preview ? ` — "${preview}"` : ''}`);
        paths.push(c.notePath as string);
        scores.push(c.score);
      }

      linkData.push({ link, candidatePaths: paths, candidateScores: scores, descriptions });
    }

    const withCandidates = linkData.filter(d => d.candidatePaths.length > 0);
    const withoutCandidates = linkData.filter(d => d.candidatePaths.length === 0);
    const results: OrganizeVaultProposal[] = [];

    if (withCandidates.length > 0) {
      try {
        const prefCtx = this.preference ? await this.preference.getPreferenceContext('organize') : '';
        const linkList = withCandidates.map((d, idx) =>
          `[${idx + 1}] Broken link: [[${d.link.targetLink}]] in "${d.link.sourcePath as string}" (line ${d.link.lineNumber})\nCandidates:\n${d.descriptions.join('\n')}`,
        ).join('\n---\n');

        const response = await this.ai.callCompletion({
          systemPrompt: 'You resolve broken wiki-links in a knowledge vault by matching them to existing notes. You are biased toward finding a match — partial or fuzzy matches count. Respond ONLY with a JSON array.',
          prompt: `${prefCtx ? prefCtx + '\n\n' : ''}These broken links need to be resolved. For each, pick the best matching candidate.

${linkList}

Rules:
1. Link text is likely a partial name, synonym, abbreviation, or informal reference.
2. Compare each link text against candidate filenames and content topics.
3. Select a candidate if ANY candidate covers the same topic, even partially.
4. Only set targetIndex to null if EVERY candidate is about a completely unrelated topic.

Return a JSON array where each element has:
- "index": link number (1-based)
- "targetIndex": candidate number (1-based) or null if no match
- "confidence": 0.0-1.0
- "rationale": one-sentence explanation`,
          maxTokens: 200 * withCandidates.length,
          temperature: 0.2,
          jsonMode: true,
        });

        const aiResults = JSON.parse(response.content) as Array<{
          index: number;
          targetIndex: number | null;
          confidence: number;
          rationale: string;
        }>;

        for (let idx = 0; idx < withCandidates.length; idx++) {
          const d = withCandidates[idx];
          const aiResult = aiResults.find(r => r.index === idx + 1);

          let bestMatch: string | null = null;
          let matchConfidence = 0.7;

          if (aiResult?.targetIndex != null
              && aiResult.targetIndex >= 1
              && aiResult.targetIndex <= d.candidatePaths.length) {
            bestMatch = d.candidatePaths[aiResult.targetIndex - 1];
            matchConfidence = Math.max(0.5, Math.min(0.95, aiResult.confidence));
          }

          results.push(this.createBrokenLinkProposal(d.link, bestMatch, matchConfidence));
        }
      } catch {
        for (const d of withCandidates) {
          const bestMatch = d.candidateScores[0] >= BROKEN_LINK_FALLBACK_SCORE
            ? d.candidatePaths[0]
            : null;
          results.push(this.createBrokenLinkProposal(d.link, bestMatch, 0.5));
        }
      }
    }

    for (const d of withoutCandidates) {
      results.push(this.createBrokenLinkProposal(d.link, null, 0.7));
    }

    return results;
  }

  private createBrokenLinkProposal(
    link: BrokenLink,
    bestMatch: string | null,
    confidence: number,
  ): OrganizeVaultProposal {
    const diffs: ProposalDiff[] = bestMatch
      ? [{ field: 'link', before: `[[${link.targetLink}]]`, after: `[[${bestMatch.replace('.md', '')}]]` }]
      : [{ field: 'link', before: `[[${link.targetLink}]]`, after: `${link.targetLink} (link removed)` }];

    return createProposal({
      type: 'fix-broken-link',
      targetPath: link.sourcePath,
      diffs,
      affectedPaths: [link.sourcePath],
      confidence,
      rationale: bestMatch
        ? `Broken link at line ${link.lineNumber}. Suggested target: ${bestMatch}`
        : `Broken link at line ${link.lineNumber}: [[${link.targetLink}]] — target does not exist.`,
    });
  }

  private generateDuplicateTagProposals(
    groups: ReadonlyArray<DuplicateTagGroup>,
  ): OrganizeVaultProposal[] {
    return groups.map(group => {
      const variants = group.variants.map(v => v.tag as string);
      const diffs: ProposalDiff[] = [{
        field: 'tags',
        before: variants.join(', '),
        after: group.canonicalTag as string,
      }];

      return createProposal({
        type: 'merge-duplicate-tags',
        targetPath: group.affectedNotes[0],
        diffs,
        affectedPaths: [...group.affectedNotes],
        confidence: 0.85,
        rationale: `${variants.length} tag variants detected. Merging to canonical: ${group.canonicalTag as string}. Affects ${group.affectedNotes.length} notes.`,
      });
    });
  }

  private async generateMissingTagProposals(
    suggestions: ReadonlyArray<MissingTagSuggestion>,
  ): Promise<OrganizeVaultProposal[]> {
    if (suggestions.length === 0) return [];

    const results: OrganizeVaultProposal[] = [];

    for (let i = 0; i < suggestions.length; i += AI_BATCH_SIZE) {
      const batch = suggestions.slice(i, i + AI_BATCH_SIZE);
      const batchResults = await this.analyzeMissingTagBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async analyzeMissingTagBatch(
    suggestions: ReadonlyArray<MissingTagSuggestion>,
  ): Promise<OrganizeVaultProposal[]> {
    const noteData: Array<{ suggestion: MissingTagSuggestion; content: string }> = [];

    for (const suggestion of suggestions) {
      const note = await this.vault.readNote(suggestion.notePath);
      if (!note) continue;
      noteData.push({
        suggestion,
        content: note.content.substring(0, CONTENT_PREVIEW_LENGTH),
      });
    }

    if (noteData.length === 0) return [];

    try {
      const settings = await this.config.getSettings();
      const knownTags = settings.knownTags ?? [];

      const noteList = noteData.map((n, idx) =>
        `[${idx + 1}] Path: ${n.suggestion.notePath as string}\nRule-suggested: ${n.suggestion.suggestedTags.map(t => t as string).join(', ')}\nContent: ${n.content}`,
      ).join('\n---\n');

      const prefCtxTags = this.preference ? await this.preference.getPreferenceContext('organize') : '';
      const response = await this.ai.callCompletion({
        systemPrompt: 'You are a tag specialist for a knowledge vault. Validate and refine tag suggestions. Respond ONLY with a JSON array.',
        prompt: `${prefCtxTags ? prefCtxTags + '\n\n' : ''}Review these tag suggestions. A rule-based system suggested tags based on keyword matching. Validate whether the tags actually fit the note content.

Known vault tags: ${knownTags.slice(0, 50).join(', ')}

Notes:
${noteList}

Return a JSON array where each element has:
- "index": note number (1-based)
- "tags": validated tag list (remove wrong ones, add missing ones, max 5)
- "confidence": 0.0-1.0
- "rationale": one-sentence explanation`,
        maxTokens: 1000,
        temperature: 0.3,
        jsonMode: true,
      });

      const aiResults = JSON.parse(response.content) as Array<{
        index: number;
        tags: string[];
        confidence: number;
        rationale: string;
      }>;

      return noteData.map((n, idx) => {
        const aiResult = aiResults.find(r => r.index === idx + 1);
        const tags = aiResult?.tags ?? n.suggestion.suggestedTags.map(t => t as string);
        const confidence = aiResult?.confidence ?? 0.65;

        return createProposal({
          type: 'apply-missing-tags',
          targetPath: n.suggestion.notePath,
          diffs: [{ field: 'tags', before: '(none)', after: tags.join(', ') }],
          affectedPaths: [n.suggestion.notePath],
          confidence: Math.max(0.3, Math.min(0.95, confidence)),
          rationale: aiResult?.rationale ?? n.suggestion.reason,
        });
      });
    } catch {
      return noteData.map(n => {
        const tags = n.suggestion.suggestedTags.map(t => t as string);
        return createProposal({
          type: 'apply-missing-tags',
          targetPath: n.suggestion.notePath,
          diffs: [{ field: 'tags', before: '(none)', after: tags.join(', ') }],
          affectedPaths: [n.suggestion.notePath],
          confidence: 0.65,
          rationale: n.suggestion.reason,
        });
      });
    }
  }

  private generateEmptyNoteProposals(
    emptyNotes: ReadonlyArray<EmptyNoteEntry>,
  ): OrganizeVaultProposal[] {
    return emptyNotes
      .filter(note => note.backlinkCount === 0)
      .map(note => {
        const diffs: ProposalDiff[] = [{
          field: 'status',
          before: 'empty (no content, no backlinks)',
          after: 'archived',
        }];

        return createProposal({
          type: 'archive-empty',
          targetPath: note.notePath,
          diffs,
          affectedPaths: [note.notePath],
          confidence: 0.9,
          rationale: 'Empty note with no backlinks.',
        });
      });
  }

  private async generateMergeProposals(
    candidates: ReadonlyArray<DuplicatePair>,
  ): Promise<OrganizeVaultProposal[]> {
    if (candidates.length === 0) return [];

    const results: OrganizeVaultProposal[] = [];
    const usedNotes = new Set<string>();

    for (let i = 0; i < candidates.length; i += MERGE_BATCH_SIZE) {
      const batch: DuplicatePair[] = [];
      const batchNotes = new Set<string>();
      for (const pair of candidates.slice(i, i + MERGE_BATCH_SIZE)) {
        const a = pair.noteA as string;
        const b = pair.noteB as string;
        if (usedNotes.has(a) || usedNotes.has(b)) continue;
        if (batchNotes.has(a) || batchNotes.has(b)) continue;
        batch.push(pair);
        batchNotes.add(a);
        batchNotes.add(b);
      }

      if (batch.length === 0) continue;
      const batchResults = await this.analyzeMergeBatch(batch);
      for (const proposal of batchResults) {
        const meta = proposal.metadata as Record<string, unknown>;
        usedNotes.add(meta.survivorPath as string);
        usedNotes.add(meta.donorPath as string);
      }
      results.push(...batchResults);
    }
    return results;
  }

  private async analyzeMergeBatch(
    pairs: ReadonlyArray<DuplicatePair>,
  ): Promise<OrganizeVaultProposal[]> {
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    const archiveFolder = settings.maintenanceArchiveFolder ?? 'Archive';

    const validPairs: Array<{
      pair: DuplicatePair;
      noteA: NonNullable<Awaited<ReturnType<VaultAccessPort['readNote']>>>;
      noteB: NonNullable<Awaited<ReturnType<VaultAccessPort['readNote']>>>;
      contentA: string;
      contentB: string;
      aTruncated: boolean;
      bTruncated: boolean;
    }> = [];

    for (const pair of pairs) {
      const noteA = await this.vault.readNote(pair.noteA);
      const noteB = await this.vault.readNote(pair.noteB);
      if (!noteA || !noteB) continue;

      const aAllowed = isNoteAllowedByRules(
        pair.noteA as string,
        noteA.metadata.tags.map(t => t as string),
        [...noteA.metadata.frontmatterKeys],
        privacyRules,
      );
      const bAllowed = isNoteAllowedByRules(
        pair.noteB as string,
        noteB.metadata.tags.map(t => t as string),
        [...noteB.metadata.frontmatterKeys],
        privacyRules,
      );
      if (!aAllowed || !bAllowed) continue;

      validPairs.push({
        pair,
        noteA,
        noteB,
        contentA: applyContentRedaction(noteA.content.substring(0, MERGE_CONTENT_MAX_LENGTH), privacyRules),
        contentB: applyContentRedaction(noteB.content.substring(0, MERGE_CONTENT_MAX_LENGTH), privacyRules),
        aTruncated: noteA.content.length > MERGE_CONTENT_MAX_LENGTH,
        bTruncated: noteB.content.length > MERGE_CONTENT_MAX_LENGTH,
      });
    }

    if (validPairs.length === 0) return [];

    try {
      const prefCtx = this.preference ? await this.preference.getPreferenceContext('organize') : '';

      const pairList = validPairs.map((d, idx) => {
        const scorePercent = Math.round(d.pair.similarityScore * 100);
        const truncNote = (d.aTruncated || d.bTruncated)
          ? `\nIMPORTANT: ${d.aTruncated ? `Note A truncated (${MERGE_CONTENT_MAX_LENGTH}/${d.noteA.content.length} chars). ` : ''}${d.bTruncated ? `Note B truncated (${MERGE_CONTENT_MAX_LENGTH}/${d.noteB.content.length} chars). ` : ''}Preserve ALL shown content.`
          : '';

        return `[Pair ${idx + 1}] Similarity: ${scorePercent}%
Note A: "${d.pair.noteA as string}" (backlinks: ${d.noteA.metadata.backlinks.length})
Content A:
${d.contentA}

Note B: "${d.pair.noteB as string}" (backlinks: ${d.noteB.metadata.backlinks.length})
Content B:
${d.contentB}${truncNote}`;
      }).join('\n\n===\n\n');

      const response = await this.ai.callCompletion({
        systemPrompt: 'You are a knowledge vault merger. You analyze pairs of similar notes and produce merged documents that preserve ALL unique information. Respond ONLY with a JSON array.',
        prompt: `${prefCtx ? prefCtx + '\n\n' : ''}Merge each pair of similar notes into one document.

${pairList}

Merge rules (apply to each pair):
1. The survivor note should have more backlinks, more content, or more established structure. If equal, prefer Note A.
2. Merged content MUST preserve every unique piece of information from both notes.
3. Merge frontmatter tags from both notes (deduplicate).
4. If information conflicts, keep the more detailed version and note with a "> [!warning] Conflict" callout.
5. Structure logically with clear headings.
6. Merged content should be valid Markdown without a frontmatter --- block.

Return a JSON array where each element has:
- "pairIndex": pair number (1-based)
- "survivorIndex": 1 or 2
- "mergedContent": "full merged markdown content (no frontmatter)"
- "mergedTags": ["tag1", "tag2"]
- "confidence": 0.0-1.0
- "rationale": "one-sentence explanation"`,
        maxTokens: 4000 * validPairs.length,
        temperature: 0.2,
        jsonMode: true,
      });

      const aiResults = JSON.parse(response.content) as Array<{
        pairIndex: number;
        survivorIndex: number;
        mergedContent: string;
        mergedTags: string[];
        confidence: number;
        rationale: string;
      }>;

      const results: OrganizeVaultProposal[] = [];
      for (let idx = 0; idx < validPairs.length; idx++) {
        const d = validPairs[idx];
        const result = aiResults.find(r => r.pairIndex === idx + 1);
        if (!result || !this.isMergeAIResponse(result)) continue;

        const scorePercent = Math.round(d.pair.similarityScore * 100);
        const survivor = result.survivorIndex === 2 ? d.pair.noteB : d.pair.noteA;
        const donor = survivor === d.pair.noteA ? d.pair.noteB : d.pair.noteA;
        const donorNote = donor === d.pair.noteA ? d.noteA : d.noteB;
        const survivorNote = survivor === d.pair.noteA ? d.noteA : d.noteB;

        const backlinksToRedirect = [...donorNote.metadata.backlinks];
        const donorBasename = (donor as string).split('/').pop()?.replace('.md', '') ?? '';
        const survivorBasename = (survivor as string).split('/').pop()?.replace('.md', '') ?? '';
        const sourceBlock = `\n\n> [!info] Merged Note\n> Merged from [[${donorBasename}]] (similarity: ${scorePercent}%).`;
        const donorFileName = (donor as string).split('/').pop() ?? '';

        const allTags = [
          ...survivorNote.metadata.tags.map(t => t as string),
          ...donorNote.metadata.tags.map(t => t as string),
        ].filter((v, i, a) => a.indexOf(v) === i);
        const mergedTags = result.mergedTags.length > 0 ? result.mergedTags : allTags;

        const diffs: ProposalDiff[] = [
          {
            field: 'merge',
            before: `${(d.pair.noteA as string).split('/').pop()} + ${(d.pair.noteB as string).split('/').pop()}`,
            after: `→ ${survivorBasename}.md (survivor)`,
          },
          {
            field: 'content',
            before: `${d.noteA.content.length} + ${d.noteB.content.length} chars`,
            after: `${result.mergedContent.length} chars (merged)`,
          },
          {
            field: 'tags',
            before: allTags.join(', ') || '(none)',
            after: mergedTags.join(', ') || '(none)',
          },
          {
            field: 'backlinks',
            before: `${backlinksToRedirect.length} notes link to ${donorBasename}`,
            after: `redirected to ${survivorBasename}`,
          },
          {
            field: 'donor',
            before: donor as string,
            after: `${archiveFolder}/${donorFileName}`,
          },
        ];

        results.push(createProposal({
          type: 'merge-duplicate-notes',
          targetPath: survivor,
          diffs,
          affectedPaths: [survivor, donor, ...backlinksToRedirect],
          confidence: Math.max(0.3, Math.min(0.95, result.confidence)),
          rationale: result.rationale,
          metadata: {
            survivorPath: survivor as string,
            donorPath: donor as string,
            mergedContent: result.mergedContent,
            mergedTags,
            sourceBlock,
            backlinksToRedirect: backlinksToRedirect.map(p => p as string),
            contentTruncated: d.aTruncated || d.bTruncated,
          },
        }));
      }
      return results;
    } catch (err) {
      console.warn('[Vaultend] Merge batch analysis failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private isMergeAIResponse(data: unknown): data is {
    survivorIndex: number;
    mergedContent: string;
    mergedTags: string[];
    confidence: number;
    rationale: string;
  } {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return (d.survivorIndex === 1 || d.survivorIndex === 2)
      && typeof d.mergedContent === 'string' && d.mergedContent.length > 0
      && Array.isArray(d.mergedTags) && d.mergedTags.every((t: unknown) => typeof t === 'string')
      && typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 1
      && typeof d.rationale === 'string';
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
