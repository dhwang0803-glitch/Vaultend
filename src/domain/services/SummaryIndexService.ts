import { NotePath } from '../values/NotePath';

export interface SummaryBatchItem {
  readonly index: number;
  readonly notePath: NotePath;
  readonly title: string;
  readonly contentExcerpt: string;
}

export interface SummaryBatchResult {
  readonly notePath: NotePath;
  readonly onelineSummary: string;
}

export class SummaryIndexService {
  static readonly BATCH_SIZE = 20;
  static readonly CONTENT_EXCERPT_LENGTH = 500;
  static readonly MAX_CONCURRENT_BATCHES = 5;

  static buildBatchItems(
    notes: ReadonlyArray<{ notePath: NotePath; title: string; content: string }>,
  ): SummaryBatchItem[] {
    return notes.map((note, i) => {
      const body = note.content.replace(/^---[\s\S]*?---\s*/, '').trim();
      return {
        index: i + 1,
        notePath: note.notePath,
        title: note.title,
        contentExcerpt: body.slice(0, SummaryIndexService.CONTENT_EXCERPT_LENGTH),
      };
    });
  }

  static parseBatchSummaryResponse(
    response: string | null | undefined,
    batchItems: ReadonlyArray<SummaryBatchItem>,
  ): SummaryBatchResult[] {
    if (!response) return [];

    let cleaned = response.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return [];
    }

    const summaries = parsed['summaries'];
    if (!summaries || typeof summaries !== 'object') return [];

    const itemMap = new Map<number, SummaryBatchItem>();
    for (const item of batchItems) {
      itemMap.set(item.index, item);
    }

    const results: SummaryBatchResult[] = [];
    for (const [key, value] of Object.entries(summaries as Record<string, unknown>)) {
      const idx = parseInt(key, 10);
      if (isNaN(idx)) continue;

      const item = itemMap.get(idx);
      if (!item) continue;

      const summary = typeof value === 'string' ? value.trim() : '';
      results.push({
        notePath: item.notePath,
        onelineSummary: summary || item.title,
      });
    }

    return results;
  }
}
