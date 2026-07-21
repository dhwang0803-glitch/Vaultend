import { NotePath } from '../../domain/values/NotePath';

const MAX_LINKS_PER_TARGET = 5;
export const DEFAULT_LINK_RELEVANCE_THRESHOLD = 7;

interface ScoredLinkEntry {
  readonly note: number;
  readonly score: number;
  readonly reason?: string;
}

function isScoredEntry(value: unknown): value is ScoredLinkEntry {
  return typeof value === 'object' && value !== null
    && 'note' in value && typeof (value as ScoredLinkEntry).note === 'number'
    && 'score' in value && typeof (value as ScoredLinkEntry).score === 'number';
}

function extractEntries(
  noteIndices: unknown,
  minScore: number,
): Array<{ idx: number }> {
  if (!Array.isArray(noteIndices)) return [];

  const entries: Array<{ idx: number }> = [];
  for (const ni of noteIndices) {
    if (isScoredEntry(ni)) {
      if (ni.score < minScore) continue;
      entries.push({ idx: ni.note });
    } else {
      const idx = typeof ni === 'number' ? ni : parseInt(String(ni), 10);
      if (!isNaN(idx)) entries.push({ idx });
    }
  }
  return entries;
}

export function parseLinkSelectionResponse(
  jsonStr: string | null | undefined,
  noteIndexToPath: ReadonlyMap<number, NotePath>,
  targetIndexToPath: ReadonlyMap<number, NotePath>,
  minScore: number = DEFAULT_LINK_RELEVANCE_THRESHOLD,
): Map<NotePath, NotePath[]> {
  const result = new Map<NotePath, NotePath[]>();

  if (!jsonStr) return result;

  let parsed: Record<string, unknown>;
  try {
    const trimmed = jsonStr.trim();
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    parsed = JSON.parse(match ? match[1].trim() : trimmed);
  } catch {
    return result;
  }

  if (typeof parsed !== 'object' || parsed === null) return result;

  const links = parsed.links;
  if (typeof links !== 'object' || links === null) return result;

  for (const [targetKey, noteIndices] of Object.entries(links as Record<string, unknown>)) {
    const targetIdx = parseInt(targetKey, 10);
    const targetPath = targetIndexToPath.get(targetIdx);
    if (!targetPath) continue;

    const entries = extractEntries(noteIndices, minScore);
    const resolved: NotePath[] = [];
    for (const { idx } of entries) {
      const notePath = noteIndexToPath.get(idx);
      if (!notePath) continue;
      if (notePath === targetPath) continue;
      if (resolved.includes(notePath)) continue;
      resolved.push(notePath);
      if (resolved.length >= MAX_LINKS_PER_TARGET) break;
    }

    if (resolved.length > 0) {
      result.set(targetPath, resolved);
    }
  }

  return result;
}
