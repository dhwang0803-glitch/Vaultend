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
  MissingTagSuggestion,
  EmptyNoteEntry,
} from '../../domain/models/OrganizeModels';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
import { ClockPort } from '../ports/ClockPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { OrganizeVaultPort } from '../ports/OrganizeVaultPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import { ConfigPort } from '../ports/ConfigPort';

const AI_BATCH_SIZE = 10;
const CONTENT_PREVIEW_LENGTH = 500;
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
  ) {}

  async execute(plan: MaintenancePlan): Promise<OrganizeVaultPlan> {
    const proposals: OrganizeVaultProposal[] = [];
    const folders = await this.collectFolders();

    proposals.push(...await this.generateOrphanProposals(plan.orphanNotes, folders));
    proposals.push(...await this.generateBrokenLinkProposals(plan.brokenLinks));
    proposals.push(...this.generateDuplicateTagProposals(plan.duplicateTags));
    proposals.push(...await this.generateMissingTagProposals(plan.missingTags));
    proposals.push(...this.generateEmptyNoteProposals(plan.emptyNotes));

    const result = createOrganizeVaultPlan(proposals, this.clock.now());
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

      const response = await this.ai.callCompletion({
        systemPrompt: 'You are a vault organizer. Analyze orphan notes and suggest the best folder, tags, and rationale for each. Respond ONLY with a JSON array.',
        prompt: `These notes have no links to or from other notes. For each, suggest where it belongs.

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

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    for (const link of brokenLinks) {
      const candidates = await this.searchIndex.search(link.targetLink, BROKEN_LINK_SEARCH_LIMIT);
      let bestMatch: string | null = null;
      let matchConfidence = 0.7;

      if (candidates.length > 0) {
        const candidateDescriptions = await Promise.all(
          candidates.map(async (c, i) => {
            const candidateNote = await this.vault.readNote(c.notePath);
            const preview = candidateNote
              ? applyContentRedaction(
                  candidateNote.content.substring(0, 150).replace(/\n/g, ' '),
                  privacyRules,
                )
              : '';
            const scorePercent = Math.round(c.score * 100);
            return `${i + 1}. ${c.notePath as string} (relevance: ${scorePercent}%)${preview ? ` — "${preview}"` : ''}`;
          }),
        );

        let aiCallFailed = false;
        try {
          const response = await this.ai.callCompletion({
            systemPrompt: 'You resolve broken wiki-links in a knowledge vault by matching them to existing notes. You are biased toward finding a match — partial or fuzzy matches count. Respond ONLY with valid JSON.',
            prompt: `A broken link [[${link.targetLink}]] was found in "${link.sourcePath as string}" (line ${link.lineNumber}). The linked note does not exist.

Below are candidate notes found by searching the vault. Pick the one that best matches the link text:
${candidateDescriptions.join('\n')}

Rules:
1. The link text is likely a partial name, synonym, abbreviation, or informal reference.
2. "${link.targetLink}" → compare each candidate's filename and content topic.
3. You MUST select a candidate if ANY candidate covers the same topic as the link text, even partially.
4. Only set targetIndex to null if EVERY candidate is about a completely unrelated topic.

Return JSON: {"targetIndex": <1-based number or null>, "confidence": 0.0-1.0, "rationale": "one sentence"}`,
            maxTokens: 200,
            temperature: 0.2,
            jsonMode: true,
          });

          const result = JSON.parse(response.content) as {
            targetIndex: number | null;
            confidence: number;
            rationale: string;
          };

          if (result.targetIndex !== null && result.targetIndex >= 1 && result.targetIndex <= candidates.length) {
            bestMatch = candidates[result.targetIndex - 1].notePath as string;
            matchConfidence = Math.max(0.5, Math.min(0.95, result.confidence));
          }
        } catch {
          aiCallFailed = true;
        }

        if (aiCallFailed && !bestMatch && candidates[0].score >= BROKEN_LINK_FALLBACK_SCORE) {
          bestMatch = candidates[0].notePath as string;
          matchConfidence = 0.5;
        }
      }

      const diffs: ProposalDiff[] = bestMatch
        ? [{ field: 'link', before: `[[${link.targetLink}]]`, after: `[[${bestMatch.replace('.md', '')}]]` }]
        : [{ field: 'link', before: `[[${link.targetLink}]]`, after: `${link.targetLink} (link removed)` }];

      results.push(createProposal({
        type: 'fix-broken-link',
        targetPath: link.sourcePath,
        diffs,
        affectedPaths: [link.sourcePath],
        confidence: matchConfidence,
        rationale: bestMatch
          ? `Broken link at line ${link.lineNumber}. Suggested target: ${bestMatch}`
          : `Broken link at line ${link.lineNumber}: [[${link.targetLink}]] — target does not exist.`,
      }));
    }

    return results;
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

      const response = await this.ai.callCompletion({
        systemPrompt: 'You are a tag specialist for a knowledge vault. Validate and refine tag suggestions. Respond ONLY with a JSON array.',
        prompt: `Review these tag suggestions. A rule-based system suggested tags based on keyword matching. Validate whether the tags actually fit the note content.

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

  private async collectFolders(): Promise<ReadonlyArray<string>> {
    const allNotes = await this.vault.listNotes();
    const folderSet = new Set<string>();
    for (const np of allNotes) {
      const pathStr = np as string;
      const slash = pathStr.lastIndexOf('/');
      if (slash > 0) folderSet.add(pathStr.substring(0, slash));
    }
    return [...folderSet].sort();
  }
}
