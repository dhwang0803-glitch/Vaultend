function tokenize(name: string): ReadonlyArray<string> {
  return name.toLowerCase().split(/[\s\-_.,()[\]{}/\\]+/).filter(t => t.length >= 2);
}

const KO_PARTICLE_RE = /(?:은|는|을|를|에|의|로|와|과|도|만|서|며|고|나|면|든)$/;

function stripKoreanSuffix(word: string): string {
  if (!/[가-힣]/.test(word)) return word;
  const stripped = word.replace(KO_PARTICLE_RE, '');
  return stripped.length >= 2 ? stripped : word;
}

const STOPWORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can',
  'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'not', 'no', 'nor',
  'for', 'with', 'from', 'into', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'of', 'in', 'on', 'at', 'by', 'as', 'if', 'so',
  'an', 'also', 'than', 'then', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'why', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'very', 'just', 'because', 'like',
  'using', 'used', 'use', 'based', 'make', 'making', 'made',
]);

function extractContentKeywords(content: string, maxKeywords: number = 30): ReadonlyArray<string> {
  const rawTokens = content.toLowerCase().split(/[\s\-_.,()[\]{}/\\:;!?'"#*`~<>|+=%&@$^]+/).filter(t => t.length >= 2);
  const freq = new Map<string, number>();
  for (const raw of rawTokens) {
    const t = stripKoreanSuffix(raw);
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const frequent = [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);

  if (frequent.length >= maxKeywords) return frequent;

  const taken = new Set(frequent);
  const singles = [...freq.entries()]
    .filter(([word, count]) => count === 1 && !taken.has(word) && word.length >= 3)
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, maxKeywords - frequent.length)
    .map(([word]) => word);

  return [...frequent, ...singles];
}

export function scoreLinkCandidates(
  currentNoteTitle: string,
  currentNoteHeadings: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
  maxCandidates: number = 50,
  noteContent?: string,
  existingTags?: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (candidates.length <= maxCandidates) return candidates;

  const sourceTokens = new Set([
    ...tokenize(currentNoteTitle),
    ...currentNoteHeadings.flatMap(h => tokenize(h)),
  ]);

  if (noteContent) {
    for (const kw of extractContentKeywords(noteContent)) {
      sourceTokens.add(kw);
    }
  }
  if (existingTags) {
    for (const tag of existingTags) {
      for (const t of tokenize(tag.replace(/^#/, ''))) {
        sourceTokens.add(t);
      }
    }
  }

  if (sourceTokens.size === 0) return candidates.slice(0, maxCandidates);

  const scored = candidates.map(name => {
    const candidateTokens = tokenize(name);
    if (candidateTokens.length === 0) return { name, score: 0 };
    const shared = candidateTokens.filter(t => sourceTokens.has(t)).length;
    return { name, score: shared / Math.max(candidateTokens.length, 1) };
  });

  scored.sort((a, b) => b.score - a.score);

  const matched = scored.filter(s => s.score > 0);
  if (matched.length >= maxCandidates) {
    return matched.slice(0, maxCandidates).map(s => s.name);
  }

  const result = matched.map(s => s.name);
  const matchedSet = new Set(result);
  for (const s of scored) {
    if (result.length >= maxCandidates) break;
    if (!matchedSet.has(s.name)) {
      result.push(s.name);
    }
  }

  return result;
}
