const PARTICLES = [
  '에서부터', '으로부터', '로부터',
  '에게서', '한테서', '으로서', '로서', '으로써', '로써',
  '에서', '에게', '한테', '부터', '까지', '처럼', '만큼', '대로',
  '으로', '에는', '에도', '에만', '와는', '과는',
  '이라', '라고', '이란', '란',
  '으로', '로', '과', '와', '의', '에', '을', '를',
  '은', '는', '이', '가', '도', '만', '야',
];

const MIN_STEM_LENGTH = 2;

export function stripKoreanParticles(token: string): string {
  for (const p of PARTICLES) {
    if (token.length > p.length + MIN_STEM_LENGTH - 1 && token.endsWith(p)) {
      const stem = token.slice(0, -p.length);
      if (stem.length >= MIN_STEM_LENGTH) return stem;
    }
  }
  return token;
}

export function preprocessQueryTokens(query: string): string[] {
  const tokens = query.split(/[\s\p{P}]+/u).filter(t => t.length >= 2);
  const result = new Set<string>();

  for (const token of tokens) {
    result.add(token);
    const stripped = stripKoreanParticles(token);
    if (stripped !== token) {
      result.add(stripped);
    }
  }

  return [...result];
}
