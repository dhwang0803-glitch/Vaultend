/**
 * Scale Test — BM25 검색 성능을 1000+ 문서에서 측정
 *
 * API 불필요. 합성 문서를 생성하여 BM25 인덱싱/검색 시간을 측정.
 * 실 사용환경에서의 검색 지연이 사용자 체감 품질에 영향주는지 확인.
 *
 * 사용법:
 *   npx tsx src/benchmark/scale-test.ts [--docs 2000] [--queries 50]
 */

import MiniSearch from 'minisearch';

interface ScaleResult {
  docCount: number;
  queryCount: number;
  indexTimeMs: number;
  avgSearchTimeMs: number;
  p95SearchTimeMs: number;
  maxSearchTimeMs: number;
  memoryMB: number;
}

const TOPICS = [
  'React', 'TypeScript', 'Node.js', 'Python', 'Docker', 'Kubernetes',
  'Git', 'CI/CD', 'Database', 'REST API', 'GraphQL', 'Microservices',
  'Testing', 'Security', 'Performance', 'Obsidian', 'PKM', 'Zettelkasten',
  'AI', 'Machine Learning', 'NLP', 'Embeddings', 'Vector DB', 'LLM',
  'Clean Architecture', 'DDD', 'SOLID', 'Design Patterns', 'Refactoring',
  'DevOps', 'Monitoring', 'Logging', 'Linux', 'Networking', 'Cloud',
  'Finance', 'Productivity', 'Habits', 'Health', 'Writing', 'Reading',
];

const VERBS = ['이해하기', '구현하기', '최적화', '비교', '설정', '활용법', '전략', '패턴', '원칙', '가이드'];
const CONTENT_PARTS = [
  '기본 개념을 이해하고 실무에 적용하는 방법.',
  '핵심 원칙과 모범 사례를 정리한다.',
  '장단점을 비교하고 적절한 선택 기준을 제시한다.',
  '초보자부터 고급 사용자까지 단계별 학습 경로.',
  '실제 프로젝트에서의 경험과 교훈을 공유한다.',
  '성능 최적화를 위한 구체적인 기법과 도구.',
  '팀 협업에서의 효과적인 활용 방법.',
  '자동화와 도구 연동으로 생산성 향상.',
];

function generateSyntheticDocs(count: number) {
  const docs: Array<{ id: string; title: string; content: string }> = [];
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const verb = VERBS[i % VERBS.length];
    const suffix = Math.floor(i / TOPICS.length);
    const title = `${topic} ${verb}${suffix > 0 ? ` (${suffix + 1})` : ''}`;
    const contentParts = Array.from({ length: 5 }, (_, j) =>
      CONTENT_PARTS[(i + j) % CONTENT_PARTS.length]
    );
    const content = `${title}\n\n${contentParts.join('\n')}`;
    docs.push({ id: `doc-${i}`, title, content });
  }
  return docs;
}

function generateQueries(count: number): string[] {
  const queries: string[] = [];
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const verb = VERBS[(i + 3) % VERBS.length];
    queries.push(`${topic} ${verb}`);
  }
  return queries;
}

function runScaleTest(docCount: number, queryCount: number): ScaleResult {
  const docs = generateSyntheticDocs(docCount);
  const queries = generateQueries(queryCount);

  // Measure indexing
  const memBefore = process.memoryUsage().heapUsed;
  const indexStart = performance.now();

  const index = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['id'],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 },
  });
  index.addAll(docs);

  const indexTimeMs = performance.now() - indexStart;
  const memAfter = process.memoryUsage().heapUsed;
  const memoryMB = (memAfter - memBefore) / 1024 / 1024;

  // Measure search
  const searchTimes: number[] = [];
  for (const query of queries) {
    const start = performance.now();
    index.search(query).slice(0, 10);
    searchTimes.push(performance.now() - start);
  }

  searchTimes.sort((a, b) => a - b);
  const avgSearchTimeMs = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
  const p95SearchTimeMs = searchTimes[Math.floor(searchTimes.length * 0.95)];
  const maxSearchTimeMs = searchTimes[searchTimes.length - 1];

  return { docCount, queryCount, indexTimeMs, avgSearchTimeMs, p95SearchTimeMs, maxSearchTimeMs, memoryMB };
}

function main() {
  const args = process.argv.slice(2);
  const docCount = args.includes('--docs') ? parseInt(args[args.indexOf('--docs') + 1]) : 2000;
  const queryCount = args.includes('--queries') ? parseInt(args[args.indexOf('--queries') + 1]) : 50;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Scale Test — BM25 Performance`);
  console.log(`${'═'.repeat(60)}\n`);

  // Run at multiple scales
  const scales = [100, 500, 1000, 2000, 5000];
  if (!scales.includes(docCount)) scales.push(docCount);
  scales.sort((a, b) => a - b);

  console.log(`${'Docs'.padEnd(8)} ${'Index(ms)'.padEnd(12)} ${'Avg(ms)'.padEnd(10)} ${'P95(ms)'.padEnd(10)} ${'Max(ms)'.padEnd(10)} ${'Mem(MB)'.padEnd(10)}`);
  console.log('─'.repeat(60));

  const results: ScaleResult[] = [];
  for (const n of scales) {
    const result = runScaleTest(n, queryCount);
    results.push(result);

    const pass = result.p95SearchTimeMs < 50 ? '✓' : result.p95SearchTimeMs < 100 ? '△' : '✗';
    console.log(
      `${String(n).padEnd(8)} ${result.indexTimeMs.toFixed(1).padStart(8)}ms  ` +
      `${result.avgSearchTimeMs.toFixed(2).padStart(7)}ms  ` +
      `${result.p95SearchTimeMs.toFixed(2).padStart(7)}ms  ` +
      `${result.maxSearchTimeMs.toFixed(2).padStart(7)}ms  ` +
      `${result.memoryMB.toFixed(1).padStart(7)}MB  ${pass}`
    );
  }

  console.log('\n── Summary ──');
  console.log(`Target: P95 search < 50ms for vault up to 5000 docs`);
  const largestResult = results[results.length - 1];
  if (largestResult.p95SearchTimeMs < 50) {
    console.log(`✓ PASS — ${largestResult.docCount} docs: P95 = ${largestResult.p95SearchTimeMs.toFixed(2)}ms`);
  } else if (largestResult.p95SearchTimeMs < 100) {
    console.log(`△ MARGINAL — ${largestResult.docCount} docs: P95 = ${largestResult.p95SearchTimeMs.toFixed(2)}ms (target < 50ms)`);
  } else {
    console.log(`✗ FAIL — ${largestResult.docCount} docs: P95 = ${largestResult.p95SearchTimeMs.toFixed(2)}ms (target < 50ms)`);
  }

  // Save results
  const fs = require('fs');
  fs.writeFileSync('src/benchmark/scale-test-results.json', JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to src/benchmark/scale-test-results.json\n`);
}

main();
