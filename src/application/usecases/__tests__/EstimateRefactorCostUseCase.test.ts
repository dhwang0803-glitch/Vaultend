import { describe, it, expect } from 'vitest';
import { EstimateRefactorCostUseCase } from '../EstimateRefactorCostUseCase';
import type { RefactorGoal, VaultMetadataSnapshot } from '../../../domain/models/RefactorModels';

function buildSnapshot(overrides?: Partial<VaultMetadataSnapshot>): VaultMetadataSnapshot {
  return {
    noteEntries: [],
    folderTree: [],
    tagFrequencies: [],
    totalNotes: 0,
    ...overrides,
  };
}

function makeEntry(path: string, opts?: { wordCount?: number; tags?: string[]; links?: string[] }) {
  return {
    path,
    tags: opts?.tags ?? [],
    links: opts?.links ?? [],
    backlinks: [],
    wordCount: opts?.wordCount ?? 200,
    createdAt: 1000,
    modifiedAt: 2000,
    folder: 'Notes',
    fileSize: 500,
  };
}

describe('EstimateRefactorCostUseCase', () => {
  const useCase = new EstimateRefactorCostUseCase();

  describe('reorganize-notes', () => {
    it('estimates based on note count and batch size', () => {
      const goal: RefactorGoal = { goalType: 'reorganize-notes', parameters: {} };
      const snapshot = buildSnapshot({ totalNotes: 120 });

      const result = useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(120);
      expect(result.chunkCount).toBe(3); // 120 / 50 = 2.4 → ceil = 3
      expect(result.estimatedAICalls).toBe(4); // 3 chunks + 1 synthesis
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
      expect(result.estimatedDurationSeconds).toBeGreaterThan(0);
    });

    it('handles zero notes', () => {
      const goal: RefactorGoal = { goalType: 'reorganize-notes', parameters: {} };
      const result = useCase.execute(goal, buildSnapshot({ totalNotes: 0 }));

      expect(result.noteCount).toBe(0);
      expect(result.estimatedAICalls).toBe(1); // 0 chunks + 1 synthesis
    });
  });

  describe('clean-up-tags', () => {
    it('estimates based on tag count', () => {
      const tags = Array.from({ length: 450 }, (_, i) => ({ tag: `#tag${i}`, count: 5 }));
      const goal: RefactorGoal = { goalType: 'clean-up-tags', parameters: {} };
      const snapshot = buildSnapshot({ tagFrequencies: tags, totalNotes: 100 });

      const result = useCase.execute(goal, snapshot);

      expect(result.tagCount).toBe(450);
      expect(result.chunkCount).toBe(3); // 450 / 200 = 2.25 → ceil = 3
      expect(result.estimatedAICalls).toBe(4); // 3 + 1 synthesis
    });
  });

  describe('suggest-links', () => {
    it('estimates based on orphan count', () => {
      const entries = [
        makeEntry('orphan1.md', { links: [] }),
        makeEntry('orphan2.md', { links: [] }),
        makeEntry('linked.md', { links: ['other.md'] }),
      ];
      // orphan1 and orphan2 have 0 backlinks + 0 links
      const goal: RefactorGoal = { goalType: 'suggest-links', parameters: {} };
      const snapshot = buildSnapshot({ noteEntries: entries, totalNotes: 3 });

      const result = useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(2); // 2 orphans
    });
  });

  describe('consolidate-fleeting', () => {
    it('estimates based on fleeting candidates', () => {
      const entries = [
        makeEntry('short1.md', { wordCount: 50, tags: [], links: [] }),
        makeEntry('short2.md', { wordCount: 80, tags: ['#tag'], links: [] }),
        makeEntry('long.md', { wordCount: 500, tags: [], links: [] }),
      ];
      const goal: RefactorGoal = {
        goalType: 'consolidate-fleeting',
        parameters: { fleetingWordCountThreshold: 150 },
      };
      const snapshot = buildSnapshot({ noteEntries: entries, totalNotes: 3 });

      const result = useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(2); // short1 + short2
    });

    it('uses default threshold when not specified', () => {
      const entries = [
        makeEntry('short.md', { wordCount: 100, tags: [], links: [] }),
      ];
      const goal: RefactorGoal = { goalType: 'consolidate-fleeting', parameters: {} };
      const snapshot = buildSnapshot({ noteEntries: entries, totalNotes: 1 });

      const result = useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(1);
    });
  });
});
