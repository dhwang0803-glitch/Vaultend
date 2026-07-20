import { NotePath } from '../../domain/values/NotePath';

const MAX_LINKS_PER_TARGET = 5;

export function parseLinkSelectionResponse(
  jsonStr: string | null | undefined,
  noteIndexToPath: ReadonlyMap<number, NotePath>,
  targetIndexToPath: ReadonlyMap<number, NotePath>,
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
    if (!Array.isArray(noteIndices)) continue;

    const resolved: NotePath[] = [];
    for (const ni of noteIndices) {
      const idx = typeof ni === 'number' ? ni : parseInt(String(ni), 10);
      if (isNaN(idx)) continue;
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
