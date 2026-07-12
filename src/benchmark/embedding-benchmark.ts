/**
 * 실환경 임베딩 벤치마크 실행기
 *
 * 사용법:
 *   OPENAI_API_KEY=sk-... npx tsx src/benchmark/embedding-benchmark.ts
 *   GEMINI_API_KEY=... npx tsx src/benchmark/embedding-benchmark.ts --provider gemini
 *
 * 출력: 콘솔에 메트릭 테이블 + benchmark-results.json 파일 생성
 */

import {
  GOLDEN_DOCUMENTS,
  GOLDEN_QUERIES,
  GoldenQuery,
  BenchmarkResult,
  precisionAtK,
  recallAtK,
  mrr,
  averageMetrics,
} from './golden-set';

// ─── Types ───

interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<Float32Array[]>;
  dimension: number;
}

// ─── OpenAI Provider ───

function createOpenAIProvider(apiKey: string, model = 'text-embedding-3-small'): EmbeddingProvider {
  let cachedDimension = 0;
  return {
    name: `openai/${model}`,
    get dimension() { return cachedDimension; },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
      }
      const json = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };
      const results = json.data.map(d => new Float32Array(d.embedding));
      if (results.length > 0) cachedDimension = results[0].length;
      return results;
    },
  };
}

// ─── Gemini Provider ───

function createGeminiProvider(apiKey: string, model = 'text-embedding-004'): EmbeddingProvider {
  let cachedDimension = 0;
  return {
    name: `gemini/${model}`,
    get dimension() { return cachedDimension; },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const requests = texts.map(text => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${await response.text()}`);
      }
      const json = await response.json() as {
        embeddings: Array<{ values: number[] }>;
      };
      const results = json.embeddings.map(e => new Float32Array(e.values));
      if (results.length > 0) cachedDimension = results[0].length;
      return results;
    },
  };
}

// ─── BM25 (MiniSearch) ───

async function bm25Search(query: string, topK: number): Promise<Array<{ id: string; score: number }>> {
  const MiniSearch = (await import('minisearch')).default;
  const index = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['id'],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 },
  });
  index.addAll(GOLDEN_DOCUMENTS.map(d => ({ id: d.id, title: d.title, content: d.content })));
  const results = index.search(query);
  return results.slice(0, topK).map(r => ({ id: r.id, score: r.score }));
}

// ─── Vector Search ───

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function vectorSearch(
  queryVec: Float32Array,
  docVecs: Map<string, Float32Array>,
  topK: number,
): Array<{ id: string; score: number }> {
  const scores: Array<{ id: string; score: number }> = [];
  for (const [id, vec] of docVecs) {
    scores.push({ id, score: cosineSimilarity(queryVec, vec) });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

// ─── Hybrid (RRF) ───

function rrfMerge(
  bm25Results: Array<{ id: string; score: number }>,
  vecResults: Array<{ id: string; score: number }>,
  k = 60,
  topK = 10,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  bm25Results.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });
  vecResults.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Benchmark Runner ───

async function runBenchmark(provider: EmbeddingProvider): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Embedding Benchmark — ${provider.name}`);
  console.log(`${'═'.repeat(60)}\n`);

  // 1. Embed all documents
  console.log(`[1/3] Embedding ${GOLDEN_DOCUMENTS.length} documents...`);
  const BATCH_SIZE = 20;
  const docVecs = new Map<string, Float32Array>();
  for (let i = 0; i < GOLDEN_DOCUMENTS.length; i += BATCH_SIZE) {
    const batch = GOLDEN_DOCUMENTS.slice(i, i + BATCH_SIZE);
    const texts = batch.map(d => `${d.title}\n${d.content}`);
    const vecs = await provider.embed(texts);
    batch.forEach((d, j) => docVecs.set(d.id, vecs[j]));
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, GOLDEN_DOCUMENTS.length)}/${GOLDEN_DOCUMENTS.length} docs\r`);
  }
  console.log(`  ✓ ${GOLDEN_DOCUMENTS.length} documents embedded (${provider.dimension}-dim)\n`);

  // 2. Run queries
  console.log(`[2/3] Running ${GOLDEN_QUERIES.length} queries...\n`);
  const bm25Results: BenchmarkResult[] = [];
  const embeddingResults: BenchmarkResult[] = [];
  const hybridResults: BenchmarkResult[] = [];

  for (const q of GOLDEN_QUERIES) {
    // BM25
    const bm25Hits = await bm25Search(q.query, 10);
    const bm25Ids = bm25Hits.map(h => h.id);
    bm25Results.push(buildResult(q, 'BM25', bm25Ids, bm25Hits));

    // Embedding
    const [queryVec] = await provider.embed([q.query]);
    const vecHits = vectorSearch(queryVec, docVecs, 10);
    const vecIds = vecHits.map(h => h.id);
    embeddingResults.push(buildResult(q, 'Embedding', vecIds, vecHits));

    // Hybrid RRF
    const hybridHits = rrfMerge(bm25Hits, vecHits, 60, 10);
    const hybridIds = hybridHits.map(h => h.id);
    hybridResults.push(buildResult(q, 'Hybrid(RRF)', hybridIds, hybridHits));
  }

  // 3. Report
  console.log(`[3/3] Results\n`);
  printReport('Overall', bm25Results, embeddingResults, hybridResults);

  const easy = (r: BenchmarkResult[]) => r.filter(x => GOLDEN_QUERIES.find(q => q.id === x.queryId)?.difficulty === 'easy');
  const medium = (r: BenchmarkResult[]) => r.filter(x => GOLDEN_QUERIES.find(q => q.id === x.queryId)?.difficulty === 'medium');
  const hard = (r: BenchmarkResult[]) => r.filter(x => GOLDEN_QUERIES.find(q => q.id === x.queryId)?.difficulty === 'hard');

  printReport('Easy (keyword match)', easy(bm25Results), easy(embeddingResults), easy(hybridResults));
  printReport('Medium (paraphrase)', medium(bm25Results), medium(embeddingResults), medium(hybridResults));
  printReport('Hard (semantic only)', hard(bm25Results), hard(embeddingResults), hard(hybridResults));

  // Per-query detail
  console.log('\n── Per-Query Detail ──\n');
  console.log(`${'Query'.padEnd(25)} ${'Diff'.padEnd(8)} ${'BM25'.padEnd(8)} ${'Embed'.padEnd(8)} ${'Hybrid'.padEnd(8)} Winner`);
  console.log('─'.repeat(70));
  for (let i = 0; i < GOLDEN_QUERIES.length; i++) {
    const q = GOLDEN_QUERIES[i];
    const b = bm25Results[i].mrr;
    const e = embeddingResults[i].mrr;
    const h = hybridResults[i].mrr;
    const best = Math.max(b, e, h);
    const winner = h === best ? 'Hybrid' : e === best ? 'Embed' : 'BM25';
    console.log(`${q.id.padEnd(25)} ${q.difficulty.padEnd(8)} ${b.toFixed(3).padEnd(8)} ${e.toFixed(3).padEnd(8)} ${h.toFixed(3).padEnd(8)} ${winner}`);
  }

  // Save results
  const output = {
    provider: provider.name,
    dimension: provider.dimension,
    timestamp: new Date().toISOString(),
    documents: GOLDEN_DOCUMENTS.length,
    queries: GOLDEN_QUERIES.length,
    overall: {
      bm25: averageMetrics(bm25Results),
      embedding: averageMetrics(embeddingResults),
      hybrid: averageMetrics(hybridResults),
    },
    byDifficulty: {
      easy: { bm25: averageMetrics(easy(bm25Results)), embedding: averageMetrics(easy(embeddingResults)), hybrid: averageMetrics(easy(hybridResults)) },
      medium: { bm25: averageMetrics(medium(bm25Results)), embedding: averageMetrics(medium(embeddingResults)), hybrid: averageMetrics(medium(hybridResults)) },
      hard: { bm25: averageMetrics(hard(bm25Results)), embedding: averageMetrics(hard(embeddingResults)), hybrid: averageMetrics(hard(hybridResults)) },
    },
    perQuery: GOLDEN_QUERIES.map((q, i) => ({
      ...q,
      bm25: { mrr: bm25Results[i].mrr, p3: bm25Results[i].precisionAt3, r3: bm25Results[i].recallAt3 },
      embedding: { mrr: embeddingResults[i].mrr, p3: embeddingResults[i].precisionAt3, r3: embeddingResults[i].recallAt3 },
      hybrid: { mrr: hybridResults[i].mrr, p3: hybridResults[i].precisionAt3, r3: hybridResults[i].recallAt3 },
    })),
  };

  const fs = await import('fs');
  const outPath = 'src/benchmark/benchmark-results.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Results saved to ${outPath}`);
}

function buildResult(
  q: GoldenQuery,
  method: string,
  retrievedIds: string[],
  hits: Array<{ id: string; score: number }>,
): BenchmarkResult {
  return {
    queryId: q.id,
    method,
    precisionAt3: precisionAtK(retrievedIds, [...q.relevant], 3),
    precisionAt5: precisionAtK(retrievedIds, [...q.relevant], 5),
    recallAt3: recallAtK(retrievedIds, [...q.relevant], 3),
    recallAt5: recallAtK(retrievedIds, [...q.relevant], 5),
    mrr: mrr(retrievedIds, [...q.relevant]),
    topResults: hits.slice(0, 5),
  };
}

function printReport(
  label: string,
  bm25: BenchmarkResult[],
  embedding: BenchmarkResult[],
  hybrid: BenchmarkResult[],
): void {
  const b = averageMetrics(bm25);
  const e = averageMetrics(embedding);
  const h = averageMetrics(hybrid);

  console.log(`┌─ ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}┐`);
  console.log(`│ ${'Method'.padEnd(14)} ${'P@3'.padEnd(8)} ${'P@5'.padEnd(8)} ${'R@3'.padEnd(8)} ${'R@5'.padEnd(8)} ${'MRR'.padEnd(8)}│`);
  console.log(`│ ${'─'.repeat(54)}│`);
  console.log(`│ ${'BM25'.padEnd(14)} ${fmt(b.avgPrecisionAt3)} ${fmt(b.avgPrecisionAt5)} ${fmt(b.avgRecallAt3)} ${fmt(b.avgRecallAt5)} ${fmt(b.avgMrr)}│`);
  console.log(`│ ${'Embedding'.padEnd(14)} ${fmt(e.avgPrecisionAt3)} ${fmt(e.avgPrecisionAt5)} ${fmt(e.avgRecallAt3)} ${fmt(e.avgRecallAt5)} ${fmt(e.avgMrr)}│`);
  console.log(`│ ${'Hybrid(RRF)'.padEnd(14)} ${fmt(h.avgPrecisionAt3)} ${fmt(h.avgPrecisionAt5)} ${fmt(h.avgRecallAt3)} ${fmt(h.avgRecallAt5)} ${fmt(h.avgMrr)}│`);
  console.log(`└${'─'.repeat(57)}┘\n`);
}

function fmt(n: number): string {
  return (n * 100).toFixed(1).padStart(5) + '%  ';
}

// ─── Main ───

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providerArg = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : 'openai';

  let provider: EmbeddingProvider;

  if (providerArg === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) { console.error('Error: GEMINI_API_KEY environment variable required'); process.exit(1); }
    provider = createGeminiProvider(key);
  } else {
    const key = process.env.OPENAI_API_KEY;
    if (!key) { console.error('Error: OPENAI_API_KEY environment variable required'); process.exit(1); }
    provider = createOpenAIProvider(key);
  }

  await runBenchmark(provider);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
