import { NotePath } from '../../domain/values/NotePath';

export interface BatchSummaryEntry {
  readonly notePath: NotePath;
  readonly onelineSummary: string;
}

export function parseBatchSummaryResponse(
  jsonStr: string | null | undefined,
  noteIndexToPath: ReadonlyMap<number, NotePath>,
): BatchSummaryEntry[] {
  if (!jsonStr) return [];

  let cleaned = jsonStr.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return [];
  }

  const summaries = parsed['summaries'];
  if (!summaries || typeof summaries !== 'object') return [];

  const results: BatchSummaryEntry[] = [];
  for (const [key, value] of Object.entries(summaries as Record<string, unknown>)) {
    const idx = parseInt(key, 10);
    if (isNaN(idx)) continue;

    const notePath = noteIndexToPath.get(idx);
    if (!notePath) continue;

    const summary = typeof value === 'string' ? value.trim() : '';
    if (!summary) continue;

    results.push({ notePath, onelineSummary: summary });
  }

  return results;
}
