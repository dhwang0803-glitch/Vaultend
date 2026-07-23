export interface CanonicalTagGroup {
  readonly canonical: string;
  readonly canonicalKey: string;
  readonly variants: ReadonlyArray<{ tag: string; count: number }>;
}

export class TagNormalizationService {
  static normalizeForComparison(tag: string): string {
    const body = tag.startsWith('#') ? tag.slice(1) : tag;
    return body.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  }

  static buildCanonicalIndex(
    tags: ReadonlyArray<{ tag: string; count: number }>,
  ): ReadonlyArray<CanonicalTagGroup> {
    const groupMap = new Map<string, Array<{ tag: string; count: number }>>();

    for (const entry of tags) {
      const key = TagNormalizationService.normalizeForComparison(entry.tag);
      if (key.length === 0) continue;
      const group = groupMap.get(key);
      if (group) {
        group.push(entry);
      } else {
        groupMap.set(key, [{ ...entry }]);
      }
    }

    const result: CanonicalTagGroup[] = [];
    for (const [canonicalKey, variants] of groupMap) {
      variants.sort((a, b) => b.count - a.count);
      result.push({
        canonical: variants[0].tag,
        canonicalKey,
        variants,
      });
    }

    return result;
  }

  static resolveToCanonical(
    tag: string,
    index: ReadonlyArray<CanonicalTagGroup>,
  ): string {
    const key = TagNormalizationService.normalizeForComparison(tag);
    for (const group of index) {
      if (group.canonicalKey === key) {
        return group.canonical;
      }
    }
    return tag;
  }

  static mergeSessionTags(
    index: ReadonlyArray<CanonicalTagGroup>,
    sessionTags: ReadonlyArray<string>,
  ): ReadonlyArray<CanonicalTagGroup> {
    const existingKeys = new Set(index.map(g => g.canonicalKey));
    const newGroups: CanonicalTagGroup[] = [];

    for (const tag of sessionTags) {
      const key = TagNormalizationService.normalizeForComparison(tag);
      if (key.length === 0 || existingKeys.has(key)) continue;
      existingKeys.add(key);
      newGroups.push({
        canonical: tag,
        canonicalKey: key,
        variants: [{ tag, count: 1 }],
      });
    }

    return [...index, ...newGroups];
  }

  static embeddingMergeThreshold(tagA: string, tagB: string): number {
    const STRICT = 0.88;
    const RELAXED = 0.75;

    const a = (tagA.startsWith('#') ? tagA.slice(1) : tagA).toLowerCase();
    const b = (tagB.startsWith('#') ? tagB.slice(1) : tagB).toLowerCase();

    if (/[^\x20-\x7E]/.test(a) || /[^\x20-\x7E]/.test(b)) return RELAXED;

    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

    if (longer.startsWith(shorter) && longer.length - shorter.length <= 3) {
      return RELAXED;
    }

    if (shorter.length <= 3) {
      const words = longer.split(/[-_]/);
      if (words.length >= shorter.length) {
        const initials = words.map(w => w[0]).join('');
        if (initials.startsWith(shorter)) return RELAXED;
      }
    }

    return STRICT;
  }

  static cosineSimilarity(
    a: ArrayLike<number>,
    b: ArrayLike<number>,
  ): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
