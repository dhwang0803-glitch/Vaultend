export type TagGroupType = 'merge' | 'nest' | 'relate';

export interface ParsedTagGroup {
  readonly canonical: string;
  readonly variants: ReadonlyArray<string>;
  readonly reason?: string;
  readonly type: TagGroupType;
}

export function parseTagGroupingResponse(
  jsonStr: string | null | undefined,
  indexToTag: ReadonlyMap<number, string>,
): ReadonlyArray<ParsedTagGroup> {
  if (!jsonStr) return [];

  let parsed: Record<string, unknown>;
  try {
    const trimmed = jsonStr.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    parsed = JSON.parse(fenceMatch ? fenceMatch[1].trim() : trimmed);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const rawGroups = parsed.groups;
  if (!Array.isArray(rawGroups)) return [];

  const result: ParsedTagGroup[] = [];

  for (const group of rawGroups) {
    if (typeof group !== 'object' || group === null) continue;

    const canonicalIdx = typeof group.canonical === 'number'
      ? group.canonical
      : parseInt(String(group.canonical), 10);
    const canonicalTag = indexToTag.get(canonicalIdx);
    if (!canonicalTag) continue;

    const rawVariants = Array.isArray(group.variants) ? group.variants : [];
    const variants: string[] = [];
    for (const v of rawVariants) {
      const idx = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (isNaN(idx)) continue;
      const tag = indexToTag.get(idx);
      if (!tag) continue;
      if (tag === canonicalTag) continue;
      if (!variants.includes(tag)) variants.push(tag);
    }

    if (variants.length === 0) continue;

    const reason = typeof group.reason === 'string' ? group.reason : undefined;
    const rawType = typeof group.type === 'string' ? group.type : 'merge';
    const type: TagGroupType = rawType === 'nest' || rawType === 'relate' ? rawType : 'merge';
    result.push({ canonical: canonicalTag, variants, reason, type });
  }

  return result;
}
