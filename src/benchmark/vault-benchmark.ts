/**
 * Vault-based Embedding Benchmark
 *
 * 실제 vault 파일을 읽어서 BM25 / Embedding / Hybrid 성능을 측정한다.
 * Obsidian 없이 독립 실행 가능.
 *
 * 사용법:
 *   npx tsx src/benchmark/vault-benchmark.ts --vault "C:\Users\daewo\obsidian\Noluma\Inbox"
 *   OPENAI_API_KEY=sk-... npx tsx src/benchmark/vault-benchmark.ts --vault "..." --embed
 *   GEMINI_API_KEY=... npx tsx src/benchmark/vault-benchmark.ts --vault "..." --embed --provider gemini
 *
 * --embed 없이 실행하면 BM25-only 모드 (API 불필요, 파이프라인 검증용)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  GOLDEN_QUERIES,
  GoldenQuery,
  BenchmarkResult,
  precisionAtK,
  recallAtK,
  mrr,
  averageMetrics,
} from './golden-set';

// ─── Vault File Reader ───

interface VaultDocument {
  id: string;
  title: string;
  content: string;
  tags: string[];
  filePath: string;
}

function readVaultFiles(vaultPath: string): VaultDocument[] {
  const entries = fs.readdirSync(vaultPath, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);
  const docs: VaultDocument[] = [];

  for (const file of files) {
    const filePath = path.join(vaultPath, file);
    const raw = fs.readFileSync(filePath, 'utf-8');

    const title = file.replace(/\.md$/, '');
    const { content, tags } = parseFrontmatter(raw);

    const id = titleToId(title);
    docs.push({ id, title, content, tags, filePath });
  }

  return docs;
}

function parseFrontmatter(raw: string): { content: string; tags: string[] } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { content: raw, tags: [] };

  const fm = fmMatch[1];
  const body = fmMatch[2];

  const tagMatch = fm.match(/tags:\s*\[(.*?)\]/);
  const tags = tagMatch
    ? tagMatch[1].split(',').map(t => t.trim())
    : [];

  // Remove heading line from body
  const content = body.replace(/^#\s+.*\n\n?/, '').trim();
  return { content, tags };
}

function titleToId(title: string): string {
  const map: Record<string, string> = {
    'React Hooks 완전 가이드': 'react-hooks-guide',
    'React 상태 관리 전략': 'react-state-management',
    'TypeScript 고급 타입 패턴': 'typescript-advanced-patterns',
    'Clean Architecture 핵심 원칙': 'clean-architecture-principles',
    'Node.js 이벤트 루프 이해하기': 'nodejs-event-loop',
    'Git 워크플로우 비교': 'git-workflow-comparison',
    'Docker 멀티스테이지 빌드': 'docker-multi-stage',
    '데이터베이스 쿼리 최적화': 'database-query-optimization',
    '테스트 전략과 철학': 'testing-philosophy',
    'REST API 설계 가이드': 'api-design-rest',
    'Zettelkasten 메모법': 'zettelkasten-method',
    '포모도로 기법 실천': 'pomodoro-technique',
    'Second Brain 구축하기': 'second-brain-building',
    'Deep Work 규칙': 'deep-work-rules',
    '습관 형성의 과학': 'habit-formation',
    'Transformer 아키텍처': 'transformer-architecture',
    '임베딩 모델 비교': 'embedding-models-comparison',
    'RAG 파이프라인 설계': 'rag-pipeline',
    '벡터 데이터베이스 선택': 'vector-database-choices',
    '프롬프트 엔지니어링 기법': 'prompt-engineering',
    'Obsidian Daily Notes 워크플로우': 'obsidian-daily-notes',
    'Obsidian 태그 전략': 'obsidian-tag-strategy',
    'Obsidian 플러그인 개발': 'obsidian-plugin-development',
    'Obsidian 링킹 전략': 'obsidian-linking-strategy',
    '수면 최적화': 'sleep-optimization',
    '인체공학적 작업 환경': 'ergonomic-workspace',
    '복리의 마법': 'compound-interest',
    '인덱스 펀드 투자 전략': 'index-fund-strategy',
    '기술 문서 작성법': 'technical-writing',
    '발표 기술': 'presentation-skills',
    '일주일 식사 준비(Meal Prep)': 'meal-prep-basics',
    '멘탈 모델 모음': 'mental-models',
    '의사결정 프레임워크': 'decision-making-frameworks',
    '번아웃 예방': 'burnout-prevention',
    '집중력 향상 기법들': 'focus-techniques',
    'Obsidian 지식 그래프 활용': 'knowledge-graph-obsidian',
    '간격 반복(Spaced Repetition)': 'spaced-repetition',
    '시맨틱 검색이란': 'semantic-search-explained',
    'Obsidian 자동화 도구': 'obsidian-automation',
    '정보 과부하 대처법': 'information-overload',
    '창의적 사고 기법': 'creative-thinking',
    'Obsidian vault 유지보수 루틴': 'obsidian-maintenance-workflow',
    '효과적인 독서법': 'reading-effectively',
    '마이크로서비스 vs 모놀리스': 'microservices-vs-monolith',
    '코드 리뷰 모범 사례': 'code-review-best-practices',
    '비동기 커뮤니케이션 원칙': 'async-communication',
    '학습법의 학습(메타 학습)': 'learning-to-learn',
  };
  return map[title] ?? title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-');
}

// ─── BM25 (MiniSearch) ───

async function bm25Search(
  docs: VaultDocument[],
  query: string,
  topK: number,
): Promise<Array<{ id: string; score: number }>> {
  const MiniSearch = (await import('minisearch')).default;
  const index = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['id'],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 },
  });
  index.addAll(docs.map(d => ({ id: d.id, title: d.title, content: d.content })));
  const results = index.search(query);
  return results.slice(0, topK).map(r => ({ id: r.id, score: r.score }));
}

// ─── Embedding Provider ───

interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<Float32Array[]>;
  dimension: number;
}

function createOpenAIProvider(apiKey: string): EmbeddingProvider {
  let dim = 0;
  return {
    name: 'openai/text-embedding-3-small',
    get dimension() { return dim; },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
      });
      if (!res.ok) throw new Error(`OpenAI: ${res.status} ${await res.text()}`);
      const json = await res.json() as { data: Array<{ embedding: number[] }> };
      const vecs = json.data.map(d => new Float32Array(d.embedding));
      if (vecs.length > 0) dim = vecs[0].length;
      return vecs;
    },
  };
}

function createGeminiProvider(apiKey: string): EmbeddingProvider {
  let dim = 0;
  return {
    name: 'gemini/text-embedding-004',
    get dimension() { return dim; },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const model = 'gemini-embedding-001';
      const requests = texts.map(text => ({ model: `models/${model}`, content: { parts: [{ text }] } }));
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:batchEmbedContents?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) throw new Error(`Gemini: ${res.status} ${await res.text()}`);
      const json = await res.json() as { embeddings: Array<{ values: number[] }> };
      const vecs = json.embeddings.map(e => new Float32Array(e.values));
      if (vecs.length > 0) dim = vecs[0].length;
      return vecs;
    },
  };
}

// ─── Vector Search ───

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d === 0 ? 0 : dot / d;
}

function vectorSearch(queryVec: Float32Array, docVecs: Map<string, Float32Array>, topK: number) {
  const scores: Array<{ id: string; score: number }> = [];
  for (const [id, vec] of docVecs) {
    scores.push({ id, score: cosineSimilarity(queryVec, vec) });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

function rrfMerge(
  bm25: Array<{ id: string; score: number }>,
  vec: Array<{ id: string; score: number }>,
  k = 60, topK = 10,
) {
  const scores = new Map<string, number>();
  bm25.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1)));
  vec.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1)));
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── Report ───

function buildResult(q: GoldenQuery, method: string, ids: string[], hits: Array<{ id: string; score: number }>): BenchmarkResult {
  return {
    queryId: q.id, method,
    precisionAt3: precisionAtK(ids, [...q.relevant], 3),
    precisionAt5: precisionAtK(ids, [...q.relevant], 5),
    recallAt3: recallAtK(ids, [...q.relevant], 3),
    recallAt5: recallAtK(ids, [...q.relevant], 5),
    mrr: mrr(ids, [...q.relevant]),
    topResults: hits.slice(0, 5),
  };
}

function printReport(label: string, bm25: BenchmarkResult[], emb?: BenchmarkResult[], hyb?: BenchmarkResult[]) {
  const b = averageMetrics(bm25);
  const fmt = (n: number) => (n * 100).toFixed(1).padStart(5) + '%  ';

  console.log(`┌─ ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}┐`);
  console.log(`│ ${'Method'.padEnd(14)} ${'P@3'.padEnd(8)} ${'P@5'.padEnd(8)} ${'R@3'.padEnd(8)} ${'R@5'.padEnd(8)} ${'MRR'.padEnd(8)}│`);
  console.log(`│ ${'─'.repeat(54)}│`);
  console.log(`│ ${'BM25'.padEnd(14)} ${fmt(b.avgPrecisionAt3)} ${fmt(b.avgPrecisionAt5)} ${fmt(b.avgRecallAt3)} ${fmt(b.avgRecallAt5)} ${fmt(b.avgMrr)}│`);
  if (emb) {
    const e = averageMetrics(emb);
    console.log(`│ ${'Embedding'.padEnd(14)} ${fmt(e.avgPrecisionAt3)} ${fmt(e.avgPrecisionAt5)} ${fmt(e.avgRecallAt3)} ${fmt(e.avgRecallAt5)} ${fmt(e.avgMrr)}│`);
  }
  if (hyb) {
    const h = averageMetrics(hyb);
    console.log(`│ ${'Hybrid(RRF)'.padEnd(14)} ${fmt(h.avgPrecisionAt3)} ${fmt(h.avgPrecisionAt5)} ${fmt(h.avgRecallAt3)} ${fmt(h.avgRecallAt5)} ${fmt(h.avgMrr)}│`);
  }
  console.log(`└${'─'.repeat(57)}┘\n`);
}

// ─── Main ───

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf('--vault');
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : null;
  const useEmbed = args.includes('--embed');
  const providerArg = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : 'openai';

  if (!vaultPath) {
    console.error('Usage: npx tsx src/benchmark/vault-benchmark.ts --vault <path> [--embed] [--provider openai|gemini]');
    process.exit(1);
  }

  if (!fs.existsSync(vaultPath)) {
    console.error(`Vault path not found: ${vaultPath}`);
    process.exit(1);
  }

  // 1. Read vault files
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Vault Benchmark — Reading from: ${vaultPath}`);
  console.log(`${'═'.repeat(60)}\n`);

  const docs = readVaultFiles(vaultPath);
  console.log(`[1/4] Read ${docs.length} documents from vault\n`);

  // Verify golden set docs are present
  const docIds = new Set(docs.map(d => d.id));
  const missingIds = GOLDEN_QUERIES.flatMap(q => [...q.relevant]).filter(id => !docIds.has(id));
  const uniqueMissing = [...new Set(missingIds)];
  if (uniqueMissing.length > 0) {
    console.warn(`⚠ Missing ${uniqueMissing.length} expected docs: ${uniqueMissing.join(', ')}`);
  }

  // 2. BM25 baseline
  console.log(`[2/4] Running BM25 baseline...\n`);
  const bm25Results: BenchmarkResult[] = [];
  for (const q of GOLDEN_QUERIES) {
    const hits = await bm25Search(docs, q.query, 10);
    bm25Results.push(buildResult(q, 'BM25', hits.map(h => h.id), hits));
  }

  // 3. Embedding (optional)
  let embResults: BenchmarkResult[] | undefined;
  let hybResults: BenchmarkResult[] | undefined;

  if (useEmbed) {
    let provider: EmbeddingProvider;
    if (providerArg === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) { console.error('GEMINI_API_KEY required'); process.exit(1); }
      provider = createGeminiProvider(key);
    } else {
      const key = process.env.OPENAI_API_KEY;
      if (!key) { console.error('OPENAI_API_KEY required'); process.exit(1); }
      provider = createOpenAIProvider(key);
    }

    console.log(`[3/4] Embedding ${docs.length} documents with ${provider.name}...`);
    const BATCH = 20;
    const docVecs = new Map<string, Float32Array>();
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      const texts = batch.map(d => `${d.title}\n${d.content}`);
      const vecs = await provider.embed(texts);
      batch.forEach((d, j) => docVecs.set(d.id, vecs[j]));
    }
    console.log(`  ✓ ${docs.length} docs embedded (${provider.dimension}-dim)\n`);

    console.log(`[4/4] Running embedding + hybrid queries...\n`);
    embResults = [];
    hybResults = [];
    for (const q of GOLDEN_QUERIES) {
      const [qVec] = await provider.embed([q.query]);
      const vecHits = vectorSearch(qVec, docVecs, 10);
      embResults.push(buildResult(q, 'Embedding', vecHits.map(h => h.id), vecHits));

      const bm25Hits = await bm25Search(docs, q.query, 10);
      const hybHits = rrfMerge(bm25Hits, vecHits, 60, 10);
      hybResults.push(buildResult(q, 'Hybrid', hybHits.map(h => h.id), hybHits));
    }
  } else {
    console.log(`[3/4] Embedding: SKIPPED (add --embed flag + API key)\n`);
    console.log(`[4/4] Hybrid: SKIPPED\n`);
  }

  // 5. Report
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Results (${docs.length} docs, ${GOLDEN_QUERIES.length} queries)`);
  console.log(`${'═'.repeat(60)}\n`);

  printReport('Overall', bm25Results, embResults, hybResults);

  const byDiff = (diff: string) => (results: BenchmarkResult[]) =>
    results.filter(r => GOLDEN_QUERIES.find(q => q.id === r.queryId)?.difficulty === diff);

  printReport('Easy (keyword)', byDiff('easy')(bm25Results), embResults && byDiff('easy')(embResults), hybResults && byDiff('easy')(hybResults));
  printReport('Medium (paraphrase)', byDiff('medium')(bm25Results), embResults && byDiff('medium')(embResults), hybResults && byDiff('medium')(hybResults));
  printReport('Hard (semantic)', byDiff('hard')(bm25Results), embResults && byDiff('hard')(embResults), hybResults && byDiff('hard')(hybResults));

  // Per-query detail
  console.log('── Per-Query Detail ──\n');
  console.log(`${'Query'.padEnd(25)} ${'Diff'.padEnd(8)} ${'BM25'.padEnd(8)} ${embResults ? 'Embed'.padEnd(8) : ''}${hybResults ? 'Hybrid'.padEnd(8) : ''}`);
  console.log('─'.repeat(embResults ? 65 : 45));
  for (let i = 0; i < GOLDEN_QUERIES.length; i++) {
    const q = GOLDEN_QUERIES[i];
    let line = `${q.id.padEnd(25)} ${q.difficulty.padEnd(8)} ${bm25Results[i].mrr.toFixed(3).padEnd(8)}`;
    if (embResults) line += ` ${embResults[i].mrr.toFixed(3).padEnd(8)}`;
    if (hybResults) line += ` ${hybResults[i].mrr.toFixed(3).padEnd(8)}`;
    console.log(line);
  }

  // Save
  const output = {
    vaultPath,
    documentsRead: docs.length,
    queries: GOLDEN_QUERIES.length,
    timestamp: new Date().toISOString(),
    provider: useEmbed ? providerArg : 'bm25-only',
    overall: {
      bm25: averageMetrics(bm25Results),
      ...(embResults && { embedding: averageMetrics(embResults) }),
      ...(hybResults && { hybrid: averageMetrics(hybResults) }),
    },
  };
  fs.writeFileSync('src/benchmark/benchmark-results.json', JSON.stringify(output, null, 2));
  console.log(`\n✓ Results saved to src/benchmark/benchmark-results.json`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
