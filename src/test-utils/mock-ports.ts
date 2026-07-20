import { vi } from 'vitest';
import type { VaultAccessPort } from '../application/ports/VaultAccessPort';
import type { AIProviderPort, ClassificationResponse, CompletionResponse } from '../application/ports/AIProviderPort';
import type { SearchIndexPort, SearchResult } from '../application/ports/SearchIndexPort';
import type { HistoryPort } from '../application/ports/HistoryPort';
import type { ConfigPort, PluginSettings } from '../application/ports/ConfigPort';
import type { ClockPort } from '../application/ports/ClockPort';
import type { PreferencePort } from '../application/ports/PreferencePort';
import type { TagEmbeddingCachePort } from '../application/ports/TagEmbeddingCachePort';

import type { Timestamp } from '../domain/values/Timestamp';
import { createDefaultSettings } from './fixtures';

export function createMockVault(overrides?: Partial<VaultAccessPort>): VaultAccessPort {
  return {
    readNote: vi.fn().mockResolvedValue(null),
    writeNote: vi.fn().mockResolvedValue(undefined),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    listNotes: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    listFolders: vi.fn().mockResolvedValue([]),
    listAllTags: vi.fn().mockResolvedValue([]),
    updateFrontmatter: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    moveNote: vi.fn().mockResolvedValue(undefined),
    readFileRaw: vi.fn().mockResolvedValue(null),
    writeFileRaw: vi.fn().mockResolvedValue(undefined),
    listNotesWithMetadata: vi.fn().mockResolvedValue([]),
    watchEvents: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

export function createMockAI(overrides?: Partial<AIProviderPort>): AIProviderPort {
  const defaultCompletion: CompletionResponse = {
    content: 'AI response',
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
    finishReason: 'stop',
  };

  const defaultClassification: ClassificationResponse = {
    category: 'general',
    suggestedTags: ['#tag1'],
    suggestedFolder: undefined,
    summary: 'summary',
    confidence: 0.9,
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
  };

  return {
    callCompletion: vi.fn().mockResolvedValue(defaultCompletion),
    callClassification: vi.fn().mockResolvedValue(defaultClassification),
    callEmbedding: vi.fn().mockResolvedValue({
      embeddings: [],
      dimension: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    }),
    ...overrides,
  };
}

export function createMockSearch(results?: ReadonlyArray<SearchResult>): SearchIndexPort {
  return {
    index: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(results ?? []),
    remove: vi.fn().mockResolvedValue(undefined),
    rebuild: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockHistory(): HistoryPort {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    undo: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockConfig(settings?: Partial<PluginSettings>): ConfigPort {
  const merged = { ...createDefaultSettings(), ...settings };
  return {
    getSettings: vi.fn().mockResolvedValue(merged),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockClock(now?: number): ClockPort {
  const ts = (now ?? 1720000000000) as Timestamp;
  return {
    now: vi.fn().mockReturnValue(ts),
  };
}

export function createMockPreference(overrides?: Partial<PreferencePort>): PreferencePort {
  return {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    recordSignal: vi.fn().mockResolvedValue({ version: 1, rules: [], signals: [], fewShotExamples: [], lastUpdated: 0 }),
    getPreferenceContext: vi.fn().mockResolvedValue(''),
    deleteRule: vi.fn().mockResolvedValue(undefined),
    resetAll: vi.fn().mockResolvedValue(undefined),
    addManualRule: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createMockTagEmbeddingCache(overrides?: Partial<TagEmbeddingCachePort>): TagEmbeddingCachePort {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockReturnValue(undefined),
    getMany: vi.fn().mockReturnValue(new Map()),
    put: vi.fn(),
    putMany: vi.fn(),
    delete: vi.fn(),
    retainOnly: vi.fn(),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
    isCompatible: vi.fn().mockReturnValue(false),
    clear: vi.fn().mockResolvedValue(undefined),
    size: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}
