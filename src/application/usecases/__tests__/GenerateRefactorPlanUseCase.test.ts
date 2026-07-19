import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateRefactorPlanUseCase } from '../GenerateRefactorPlanUseCase';
import {
  createMockVault,
  createMockAI,
  createMockSearch,
  createMockConfig,
  createMockClock,
} from '../../../test-utils/mock-ports';
import type { OrganizeVaultPort } from '../../ports/OrganizeVaultPort';
import type { RefactorGoal, NoteMetadataEntry, RefactorProgress } from '../../../domain/models/RefactorModels';
import type { CompletionResponse } from '../../ports/AIProviderPort';
import { createNotePath } from '../../../domain/values/NotePath';
import { createNote } from '../../../domain/models/Note';
import { createNoteId } from '../../../domain/values/NoteId';
import { createNoteTitle } from '../../../domain/values/NoteTitle';
import { createTimestamp } from '../../../domain/values/Timestamp';

function makeEntry(path: string, opts?: Partial<NoteMetadataEntry>): NoteMetadataEntry {
  return {
    path,
    tags: [],
    links: [],
    backlinks: [],
    wordCount: 200,
    createdAt: 1000,
    modifiedAt: 2000,
    folder: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '',
    fileSize: 500,
    ...opts,
  };
}

function makeNote(path: string, content: string) {
  return createNote({
    id: createNoteId(path),
    path: createNotePath(path),
    title: createNoteTitle(path.split('/').pop()?.replace('.md', '') ?? ''),
    content,
    metadata: {
      tags: [], aliases: [], links: [], backlinks: [], frontmatterKeys: [],
      createdAt: createTimestamp(1000), modifiedAt: createTimestamp(2000),
      fileSize: content.length, isProcessed: false,
    },
    chunks: [],
  });
}

function mockCompletionResponse(content: string): CompletionResponse {
  return {
    content,
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUsd: 0.01 },
    finishReason: 'stop',
  };
}

describe('GenerateRefactorPlanUseCase', () => {
  let vault: ReturnType<typeof createMockVault>;
  let ai: ReturnType<typeof createMockAI>;
  let store: OrganizeVaultPort;
  let useCase: GenerateRefactorPlanUseCase;
  let progressUpdates: RefactorProgress[];

  beforeEach(() => {
    vault = createMockVault();
    ai = createMockAI();
    store = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      updateProposalStatus: vi.fn().mockResolvedValue(null),
    };
    const config = createMockConfig();
    const clock = createMockClock();
    const search = createMockSearch();

    useCase = new GenerateRefactorPlanUseCase(clock, vault, search, store, ai, config);
    progressUpdates = [];
  });

  const onProgress = (p: RefactorProgress) => progressUpdates.push(p);
  const signal = new AbortController().signal;

  describe('Mode 2: Tag Cleanup', () => {
    const goal: RefactorGoal = { goalType: 'clean-up-tags', parameters: {} };

    it('generates merge-duplicate-tags proposals from AI analysis', async () => {
      const entries = [
        makeEntry('note1.md', { tags: ['#JS', '#javascript'] }),
        makeEntry('note2.md', { tags: ['#JS'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([
        { tag: '#JS', count: 2 },
        { tag: '#javascript', count: 1 },
      ]);

      const chunkResponse = JSON.stringify({
        mergeGroups: [
          { canonical: '#javascript', variants: ['#JS', '#javascript'], confidence: 0.9, rationale: 'Same language' },
        ],
      });

      const synthResponse = JSON.stringify({
        mergeGroups: [
          { canonical: '#javascript', variants: ['#JS'], confidence: 0.9, rationale: 'Same language' },
        ],
        missingTagSuggestions: [],
      });

      vi.mocked(ai.callCompletion)
        .mockResolvedValueOnce(mockCompletionResponse(chunkResponse))
        .mockResolvedValueOnce(mockCompletionResponse(synthResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBe(1);
      expect(plan.proposals[0].type).toBe('merge-duplicate-tags');
      expect(plan.proposals[0].metadata?.source).toBe('refactor');
      expect(store.save).toHaveBeenCalledOnce();
    });

    it('handles empty tags gracefully', async () => {
      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue([]);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBe(0);
      expect(ai.callCompletion).not.toHaveBeenCalled();
    });

    it('generates apply-missing-tags from synthesis suggestions', async () => {
      const entries = [makeEntry('untagged.md')];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([{ tag: '#python', count: 5 }]);
      vi.mocked(vault.readNote).mockResolvedValue(makeNote('untagged.md', 'Python tutorial content about decorators'));

      const chunkResponse = JSON.stringify({ mergeGroups: [] });
      const synthResponse = JSON.stringify({
        mergeGroups: [],
        missingTagSuggestions: [
          { notePath: 'untagged.md', tags: ['#python'], confidence: 0.8, rationale: 'Content about Python' },
        ],
      });
      const untaggedResponse = JSON.stringify({
        suggestions: [
          { notePath: 'untagged.md', tags: ['#python'], confidence: 0.85, rationale: 'Detected from content' },
        ],
      });

      vi.mocked(ai.callCompletion)
        .mockResolvedValueOnce(mockCompletionResponse(chunkResponse))
        .mockResolvedValueOnce(mockCompletionResponse(synthResponse))
        .mockResolvedValueOnce(mockCompletionResponse(untaggedResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      const tagProposals = plan.proposals.filter(p => p.type === 'apply-missing-tags');
      expect(tagProposals.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back when synthesis AI fails', async () => {
      const entries = [makeEntry('note.md', { tags: ['#JS'] })];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([{ tag: '#JS', count: 1 }, { tag: '#javascript', count: 1 }]);

      const chunkResponse = JSON.stringify({
        mergeGroups: [
          { canonical: '#javascript', variants: ['#JS'], confidence: 0.85, rationale: 'Same' },
        ],
      });

      vi.mocked(ai.callCompletion)
        .mockResolvedValueOnce(mockCompletionResponse(chunkResponse))
        .mockRejectedValueOnce(new Error('AI error'));

      const plan = await useCase.execute(goal, signal, onProgress);

      const mergeProposals = plan.proposals.filter(p => p.type === 'merge-duplicate-tags');
      expect(mergeProposals.length).toBe(1);
    });
  });

  describe('Mode 1: Note Reorganize (orphan-focused)', () => {
    const goal: RefactorGoal = { goalType: 'reorganize-notes', parameters: {} };

    it('generates reposition proposals for orphan notes', async () => {
      const entries = [
        makeEntry('Inbox/cooking-recipe.md', { folder: 'Inbox', tags: ['#cooking'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);
      vi.mocked(vault.readNote).mockResolvedValue(makeNote('Inbox/cooking-recipe.md', 'A delicious pasta recipe...'));

      const aiResponse = JSON.stringify([
        { index: 1, suggestedFolder: 'Recipes', confidence: 0.85, rationale: 'Cooking content belongs in Recipes' },
      ]);

      vi.mocked(ai.callCompletion).mockResolvedValue(mockCompletionResponse(aiResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      const repositions = plan.proposals.filter(p => p.type === 'reposition');
      expect(repositions.length).toBe(1);
      expect(repositions[0].metadata?.suggestedFolder).toBe('Recipes');
    });

    it('skips orphan notes already in best folder', async () => {
      const entries = [
        makeEntry('Recipes/pasta.md', { folder: 'Recipes' }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);
      vi.mocked(vault.readNote).mockResolvedValue(makeNote('Recipes/pasta.md', 'Pasta recipe'));

      const aiResponse = JSON.stringify([
        { index: 1, suggestedFolder: 'Recipes', confidence: 0.95, rationale: 'Already correct' },
      ]);

      vi.mocked(ai.callCompletion).mockResolvedValue(mockCompletionResponse(aiResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.filter(p => p.type === 'reposition').length).toBe(0);
    });

    it('generates archive proposals for empty notes', async () => {
      const entries = [
        makeEntry('Notes/empty.md', { folder: 'Notes', wordCount: 0, links: ['other.md'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const plan = await useCase.execute(goal, signal, onProgress);

      const archiveProposals = plan.proposals.filter(p => p.type === 'archive-empty');
      expect(archiveProposals.length).toBe(1);
      expect(archiveProposals[0].rationale).toContain('Empty note');
    });

    it('returns empty when no orphans or empty notes exist', async () => {
      const entries = [
        makeEntry('Notes/connected.md', { folder: 'Notes', links: ['other.md'], backlinks: ['another.md'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBe(0);
    });
  });

  describe('Mode 3: Link Suggestions', () => {
    const goal: RefactorGoal = { goalType: 'suggest-links', parameters: {} };

    it('generates link suggestions for orphan notes', async () => {
      const entries = [
        makeEntry('orphan.md', { links: [], backlinks: [] }),
        makeEntry('related.md', { links: ['other.md'], backlinks: ['other.md'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);
      vi.mocked(vault.readNote).mockResolvedValue(makeNote('orphan.md', 'TypeScript testing guide'));

      const search = createMockSearch([
        { notePath: createNotePath('related.md'), score: 0.8, highlights: [] },
      ]);
      const config = createMockConfig();
      const clock = createMockClock();
      useCase = new GenerateRefactorPlanUseCase(clock, vault, search, store, ai, config);

      const aiResponse = JSON.stringify({
        suggestedLinks: [
          { targetPath: 'related.md', confidence: 0.8, rationale: 'Related testing content' },
        ],
      });

      vi.mocked(ai.callCompletion).mockResolvedValue(mockCompletionResponse(aiResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBeGreaterThanOrEqual(1);
      const linkProposal = plan.proposals.find(p => p.metadata?.suggestedLinks);
      expect(linkProposal).toBeDefined();
    });

    it('handles no orphans', async () => {
      const entries = [
        makeEntry('linked.md', { links: ['other.md'], backlinks: ['other.md'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBe(0);
    });

    it('detects broken wiki-links and suggests fixes', async () => {
      const entries = [
        makeEntry('doc.md', { links: ['existing.md'], backlinks: ['other.md'] }),
        makeEntry('existing.md', { links: [], backlinks: ['doc.md'] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);
      vi.mocked(vault.readNote).mockImplementation(async (path) => {
        if ((path as string) === 'doc.md') {
          return makeNote('doc.md', 'See [[non-existent-note]] for details.');
        }
        return null;
      });

      const search = createMockSearch([
        { notePath: createNotePath('existing.md'), score: 0.7, highlights: [] },
      ]);
      const config = createMockConfig();
      const clock = createMockClock();
      useCase = new GenerateRefactorPlanUseCase(clock, vault, search, store, ai, config);

      const plan = await useCase.execute(goal, signal, onProgress);

      const fixProposals = plan.proposals.filter(p => p.type === 'fix-broken-link');
      expect(fixProposals.length).toBe(1);
      expect(fixProposals[0].metadata?.brokenLink).toBe('non-existent-note');
      expect(fixProposals[0].metadata?.suggestedTarget).toBe('existing.md');
    });
  });

  describe('Mode 4: Fleeting Notes', () => {
    const goal: RefactorGoal = {
      goalType: 'consolidate-fleeting',
      parameters: { fleetingWordCountThreshold: 150 },
    };

    it('clusters and merges fleeting notes', async () => {
      const entries = [
        makeEntry('quick1.md', { wordCount: 50, tags: [], links: [] }),
        makeEntry('quick2.md', { wordCount: 60, tags: [], links: [] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const sharedContent = 'typescript testing patterns vitest framework unit integration coverage assertion mock stub spy describe expect beforeEach afterEach';
      vi.mocked(vault.readNote).mockImplementation(async (path) => {
        const p = path as string;
        if (p === 'quick1.md') return makeNote('quick1.md', sharedContent + ' plus some extra ideas about testing');
        if (p === 'quick2.md') return makeNote('quick2.md', sharedContent + ' with additional notes on vitest setup');
        return null;
      });

      const mergeResponse = JSON.stringify({
        mergedTitle: 'TypeScript Testing Notes',
        mergedContent: '# TypeScript Testing\n\nCombined notes about testing...',
        mergedTags: ['#testing', '#typescript'],
        confidence: 0.85,
        rationale: 'Both notes discuss TypeScript testing',
      });

      vi.mocked(ai.callCompletion).mockResolvedValue(mockCompletionResponse(mergeResponse));

      const plan = await useCase.execute(goal, signal, onProgress);

      const mergeProposals = plan.proposals.filter(p => p.type === 'merge-duplicate-notes');
      expect(mergeProposals.length).toBe(1);
      expect(mergeProposals[0].metadata?.source).toBe('refactor');
    });

    it('skips when fewer than minimum cluster size', async () => {
      const entries = [
        makeEntry('single.md', { wordCount: 50, tags: [], links: [] }),
      ];

      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue(entries);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const plan = await useCase.execute(goal, signal, onProgress);

      expect(plan.proposals.length).toBe(0);
    });
  });

  describe('cancellation', () => {
    it('throws AbortError when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const goal: RefactorGoal = { goalType: 'clean-up-tags', parameters: {} };

      await expect(
        useCase.execute(goal, controller.signal, onProgress),
      ).rejects.toThrow('Refactor cancelled by user');
    });
  });

  describe('progress reporting', () => {
    it('reports progress through phases', async () => {
      vi.mocked(vault.listNotesWithMetadata).mockResolvedValue([]);
      vi.mocked(vault.listAllTags).mockResolvedValue([]);

      const goal: RefactorGoal = { goalType: 'clean-up-tags', parameters: {} };
      await useCase.execute(goal, signal, onProgress);

      expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
      expect(progressUpdates[0].phase).toBe('collecting');
      expect(progressUpdates[progressUpdates.length - 1].phase).toBe('converting');
    });
  });
});
