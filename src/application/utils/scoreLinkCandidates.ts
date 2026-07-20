function tokenize(name: string): ReadonlyArray<string> {
  return name.toLowerCase().split(/[\s\-_.,()[\]{}/\\]+/).filter(t => t.length >= 2);
}

export function scoreLinkCandidates(
  currentNoteTitle: string,
  currentNoteHeadings: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
  maxCandidates: number = 50,
): ReadonlyArray<string> {
  if (candidates.length <= maxCandidates) return candidates;

  const sourceTokens = new Set([
    ...tokenize(currentNoteTitle),
    ...currentNoteHeadings.flatMap(h => tokenize(h)),
  ]);

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
