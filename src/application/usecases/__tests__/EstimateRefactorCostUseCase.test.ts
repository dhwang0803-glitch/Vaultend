import { describe, it, expect } from 'vitest';
import { EstimateRefactorCostUseCase } from '../EstimateRefactorCostUseCase';
import type { RefactorGoal, VaultMetadataSnapshot } from '../../../domain/models/RefactorModels';
import type { ConfigPort } from '../../ports/ConfigPort';
import { createDefaultSettings } from '../../../test-utils/fixtures';

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

const mockConfig: ConfigPort = {
  getSettings: async () => createDefaultSettings({ aiProvider: 'openai', aiModel: 'gpt-4o' }),
  saveSettings: async () => {},
  updateSettings: async () => {},
};

describe('EstimateRefactorCostUseCase', () => {
  const useCase = new EstimateRefactorCostUseCase(mockConfig);

  describe('reorganize-notes', () => {
    it('estimates based on orphan count and batch size', async () => {
      const goal: RefactorGoal = { goalType: 'reorganize-notes', parameters: {} };
      const orphans = Array.from({ length: 120 }, (_, i) => makeEntry(`orphan${i}.md`));
      const snapshot = buildSnapshot({ noteEntries: orphans, totalNotes: 120 });

      const result = await useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(120);
      expect(result.chunkCount).toBe(3); // 120 / 50 = 2.4 → ceil = 3
      expect(result.estimatedAICalls).toBe(4); // 3 chunks + 1 tier2
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
      expect(result.estimatedDurationSeconds).toBeGreaterThan(0);
    });

    it('handles zero orphans', async () => {
      const goal: RefactorGoal = { goalType: 'reorganize-notes', parameters: {} };
      const linked = [makeEntry('linked.md', { links: ['other.md'] })];
      const result = await useCase.execute(goal, buildSnapshot({ noteEntries: linked, totalNotes: 1 }));

      expect(result.noteCount).toBe(0);
      expect(result.estimatedAICalls).toBe(1); // 0 chunks + 1 tier2
    });
  });

  describe('clean-up-tags', () => {
    it('estimates based on tag count including untagged notes', async () => {
      const tags = Array.from({ length: 450 }, (_, i) => ({ tag: `#tag${i}`, count: 5 }));
      const tagged = Array.from({ length: 80 }, (_, i) => makeEntry(`tagged${i}.md`, { tags: ['#tag0'] }));
      const untagged = Array.from({ length: 20 }, (_, i) => makeEntry(`untagged${i}.md`, { tags: [] }));
      const goal: RefactorGoal = { goalType: 'clean-up-tags', parameters: {} };
      const snapshot = buildSnapshot({
        noteEntries: [...tagged, ...untagged],
        tagFrequencies: tags,
        totalNotes: 100,
      });

      const result = await useCase.execute(goal, snapshot);

      expect(result.tagCount).toBe(450);
      expect(result.chunkCount).toBe(4); // ceil(450/200)=3 tag chunks + ceil(20/50)=1 untagged chunk
      expect(result.estimatedAICalls).toBe(5); // 3 tag + 1 synthesis + 1 untagged
    });
  });

  describe('suggest-links', () => {
    it('estimates based on orphan count plus broken link scan', async () => {
      const entries = [
        makeEntry('orphan1.md', { links: [] }),
        makeEntry('orphan2.md', { links: [] }),
        makeEntry('linked.md', { links: ['other.md'] }),
      ];
      const goal: RefactorGoal = { goalType: 'suggest-links', parameters: {} };
      const snapshot = buildSnapshot({ noteEntries: entries, totalNotes: 3 });

      const result = await useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(5); // 2 orphans + 3 total (broken link scan)
      expect(result.estimatedAICalls).toBe(2); // ceil(2/50)=1 orphan chunk + 1 broken link scan
    });
  });

  describe('consolidate-fleeting', () => {
    it('estimates based on fleeting candidates', async () => {
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

      const result = await useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(2); // short1 + short2
    });

    it('uses default threshold when not specified', async () => {
      const entries = [
        makeEntry('short.md', { wordCount: 100, tags: [], links: [] }),
      ];
      const goal: RefactorGoal = { goalType: 'consolidate-fleeting', parameters: {} };
      const snapshot = buildSnapshot({ noteEntries: entries, totalNotes: 1 });

      const result = await useCase.execute(goal, snapshot);

      expect(result.noteCount).toBe(1);
    });
  });
});
