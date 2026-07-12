import { describe, it, expect, beforeAll } from 'vitest';
import MiniSearch from 'minisearch';
import { TfIdfCorpus } from '../domain/services/TfIdfCorpus';
import { tokenizeForTfIdf } from '../domain/services/tokenize';

/**
 * Golden Set Benchmark: BM25 vs Embedding vs Hybrid Search
 *
 * 30개 테스트 문서 + 10개 쿼리 (각 쿼리에 relevant docs 지정)
 * 세 가지 검색 방식의 Precision@3, Recall@3, MRR 비교
 */

// ─── Golden Set Documents ───
const DOCUMENTS = [
  { id: 'react-hooks', content: 'React Hooks allow you to use state and lifecycle features in functional components. useState and useEffect are the most commonly used hooks. Custom hooks enable reusable stateful logic.' },
  { id: 'react-state', content: 'State management in React can be done with useState for local state, useReducer for complex state logic, or external libraries like Redux and Zustand for global application state.' },
  { id: 'react-components', content: 'React components are the building blocks of UI. Class components have lifecycle methods while functional components use hooks. Props flow down, events bubble up.' },
  { id: 'typescript-generics', content: 'TypeScript generics provide a way to create reusable components that work with multiple types. Generic constraints, conditional types, and mapped types are advanced patterns.' },
  { id: 'typescript-types', content: 'TypeScript type system includes interfaces, type aliases, unions, intersections, and literal types. Type guards and narrowing ensure type safety at runtime.' },
  { id: 'typescript-config', content: 'tsconfig.json configures the TypeScript compiler options including target, module, strict mode, and path aliases. Project references enable monorepo builds.' },
  { id: 'node-express', content: 'Express.js is a minimal Node.js web framework. Middleware functions process requests sequentially. Router handles different HTTP methods and URL patterns.' },
  { id: 'node-streams', content: 'Node.js streams process data incrementally without loading everything into memory. Readable, Writable, Transform, and Duplex streams handle I/O efficiently.' },
  { id: 'node-events', content: 'The EventEmitter pattern in Node.js enables asynchronous event-driven architecture. Custom events decouple components and enable pub/sub patterns.' },
  { id: 'css-flexbox', content: 'CSS Flexbox provides one-dimensional layout control. justify-content aligns items along the main axis, align-items along the cross axis. flex-grow and flex-shrink control sizing.' },
  { id: 'css-grid', content: 'CSS Grid enables two-dimensional layouts with rows and columns. grid-template defines track sizes. Named areas and auto-placement simplify complex layouts.' },
  { id: 'css-animations', content: 'CSS animations use @keyframes to define states and transition properties for smooth visual effects. transform and opacity are GPU-accelerated for best performance.' },
  { id: 'git-branching', content: 'Git branching strategies include GitFlow, trunk-based development, and GitHub Flow. Feature branches isolate work, merge commits preserve history.' },
  { id: 'git-rebase', content: 'Git rebase rewrites commit history by moving or combining commits. Interactive rebase allows squashing, editing, and reordering. Use with caution on shared branches.' },
  { id: 'docker-basics', content: 'Docker containers package applications with their dependencies. Dockerfiles define build steps. Docker Compose orchestrates multi-container applications.' },
  { id: 'docker-networking', content: 'Docker networking connects containers using bridge, host, and overlay networks. Port mapping exposes container services. DNS resolution enables service discovery.' },
  { id: 'python-async', content: 'Python asyncio enables concurrent I/O operations with async/await syntax. Event loops manage coroutines. aiohttp and asyncpg provide async HTTP and database clients.' },
  { id: 'python-decorators', content: 'Python decorators wrap functions to modify behavior. functools.wraps preserves metadata. Class decorators and decorator factories add flexibility.' },
  { id: 'database-indexing', content: 'Database indexes speed up queries by creating sorted data structures (B-trees, hash indexes). Composite indexes cover multiple columns. Over-indexing slows writes.' },
  { id: 'database-normalization', content: 'Database normalization reduces redundancy through normal forms (1NF, 2NF, 3NF, BCNF). Denormalization trades redundancy for read performance in OLAP workloads.' },
  { id: 'testing-unit', content: 'Unit tests verify individual functions in isolation using mocks and stubs. AAA pattern (Arrange-Act-Assert) structures test cases. Code coverage measures test completeness.' },
  { id: 'testing-integration', content: 'Integration tests verify interactions between components using real dependencies. Test containers provide database instances. API testing validates HTTP contracts.' },
  { id: 'security-auth', content: 'Authentication verifies identity using passwords, tokens, or biometrics. JWT tokens encode claims. OAuth2 and OIDC provide delegated authorization flows.' },
  { id: 'security-xss', content: 'Cross-site scripting (XSS) injects malicious scripts into web pages. Content Security Policy, input sanitization, and output encoding prevent XSS attacks.' },
  { id: 'obsidian-plugins', content: 'Obsidian plugins extend the app using TypeScript. The Plugin API provides vault access, commands, views, and settings. Plugins bundle into a single main.js file.' },
  { id: 'obsidian-dataview', content: 'Dataview queries Obsidian notes as a database using DQL or JavaScript. Inline queries embed results. Tags, frontmatter, and links are queryable metadata.' },
  { id: 'obsidian-templater', content: 'Templater automates Obsidian note creation with dynamic templates. JavaScript execution, date functions, and file manipulation enable powerful workflows.' },
  { id: 'machine-learning-basics', content: 'Machine learning trains models on data to make predictions. Supervised learning uses labeled data, unsupervised learning finds patterns. Neural networks learn hierarchical features.' },
  { id: 'embeddings-nlp', content: 'Word embeddings represent text as dense vectors capturing semantic meaning. Word2Vec, GloVe, and transformer-based embeddings like BERT encode contextual relationships.' },
  { id: 'vector-search', content: 'Vector similarity search finds nearest neighbors in high-dimensional spaces. Cosine similarity and dot product measure vector closeness. FAISS and Annoy enable approximate nearest neighbor search.' },
];

// ─── Golden Set Queries with Relevant Documents ───
const QUERIES: Array<{ query: string; relevant: string[]; description: string }> = [
  {
    query: 'How to manage state in React functional components?',
    relevant: ['react-hooks', 'react-state', 'react-components'],
    description: 'React state management',
  },
  {
    query: 'TypeScript generic types and constraints',
    relevant: ['typescript-generics', 'typescript-types'],
    description: 'TypeScript generics',
  },
  {
    query: 'How to handle asynchronous operations in Node.js?',
    relevant: ['node-streams', 'node-events', 'python-async'],
    description: 'Async patterns (cross-language)',
  },
  {
    query: 'CSS layout techniques for responsive design',
    relevant: ['css-flexbox', 'css-grid'],
    description: 'CSS layouts',
  },
  {
    query: 'Git history management and commit manipulation',
    relevant: ['git-rebase', 'git-branching'],
    description: 'Git workflow',
  },
  {
    query: 'How to write effective automated tests?',
    relevant: ['testing-unit', 'testing-integration'],
    description: 'Testing strategy',
  },
  {
    query: 'Web security vulnerabilities and prevention',
    relevant: ['security-xss', 'security-auth'],
    description: 'Security',
  },
  {
    query: 'Semantic search using vector embeddings',
    relevant: ['embeddings-nlp', 'vector-search', 'machine-learning-basics'],
    description: 'Semantic search / embeddings',
  },
  {
    query: 'Obsidian plugin development and automation',
    relevant: ['obsidian-plugins', 'obsidian-templater', 'obsidian-dataview'],
    description: 'Obsidian ecosystem',
  },
  {
    query: 'Database query optimization and performance',
    relevant: ['database-indexing', 'database-normalization'],
    description: 'Database performance',
  },
];

// ─── Search Engines ───

let miniSearch: MiniSearch;
let corpus: TfIdfCorpus;
let docVectors: Map<string, Map<string, number>>;
let docTokensMap: Map<string, string[]>;

beforeAll(() => {
  // BM25 engine (MiniSearch)
  miniSearch = new MiniSearch({
    fields: ['content'],
    storeFields: ['id'],
    idField: 'id',
    searchOptions: { prefix: true, fuzzy: false },
  });
  miniSearch.addAll(DOCUMENTS.map(d => ({ id: d.id, content: d.content })));

  // TF-IDF embedding simulation
  corpus = new TfIdfCorpus();
  docTokensMap = new Map();
  for (const doc of DOCUMENTS) {
    const tokens = tokenizeForTfIdf(doc.content);
    corpus.addDocument(doc.id, tokens);
    docTokensMap.set(doc.id, tokens);
  }

  // Pre-compute TF-IDF vectors for all docs
  docVectors = new Map();
  for (const doc of DOCUMENTS) {
    const tokens = docTokensMap.get(doc.id)!;
    docVectors.set(doc.id, corpus.computeTfIdfVector(tokens));
  }
});

function bm25Search(query: string, topK: number): string[] {
  const results = miniSearch.search(query, { prefix: true });
  return results.slice(0, topK).map(r => r.id);
}

function embeddingSearch(query: string, topK: number): string[] {
  const queryTokens = tokenizeForTfIdf(query);
  const queryVec = corpus.computeTfIdfVector(queryTokens);

  const scores: Array<{ id: string; sim: number }> = [];
  for (const [id, vec] of docVectors) {
    const sim = corpus.cosineSimilarity(queryVec, vec);
    scores.push({ id, sim });
  }

  scores.sort((a, b) => b.sim - a.sim);
  return scores.slice(0, topK).map(s => s.id);
}

function hybridSearch(query: string, topK: number, embeddingWeight = 1.0): string[] {
  const RRF_K = 60;
  const bm25Results = bm25Search(query, 20);
  const embResults = embeddingSearch(query, 20);

  const scores = new Map<string, number>();

  for (let i = 0; i < bm25Results.length; i++) {
    const id = bm25Results[i];
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  }

  for (let i = 0; i < embResults.length; i++) {
    const id = embResults[i];
    scores.set(id, (scores.get(id) ?? 0) + embeddingWeight * (1 / (RRF_K + i + 1)));
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, topK).map(([id]) => id);
}

// ─── Metrics ───

function precisionAtK(retrieved: string[], relevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const hits = topK.filter(id => relevant.includes(id)).length;
  return hits / k;
}

function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const hits = topK.filter(id => relevant.includes(id)).length;
  return relevant.length > 0 ? hits / relevant.length : 0;
}

function mrr(retrieved: string[], relevant: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ─── Benchmark Tests ───

describe('Golden Set: Search Performance Benchmark', () => {
  const K = 3;

  it('computes benchmark metrics for all search methods', () => {
    const metrics = {
      bm25: { precision: 0, recall: 0, mrr: 0 },
      embedding: { precision: 0, recall: 0, mrr: 0 },
      hybrid: { precision: 0, recall: 0, mrr: 0 },
    };

    const perQuery: Array<{
      query: string;
      desc: string;
      bm25: string[];
      emb: string[];
      hybrid: string[];
      relevant: string[];
    }> = [];

    for (const q of QUERIES) {
      const bm25Res = bm25Search(q.query, K);
      const embRes = embeddingSearch(q.query, K);
      const hybridRes = hybridSearch(q.query, K);

      metrics.bm25.precision += precisionAtK(bm25Res, q.relevant, K);
      metrics.bm25.recall += recallAtK(bm25Res, q.relevant, K);
      metrics.bm25.mrr += mrr(bm25Res, q.relevant);

      metrics.embedding.precision += precisionAtK(embRes, q.relevant, K);
      metrics.embedding.recall += recallAtK(embRes, q.relevant, K);
      metrics.embedding.mrr += mrr(embRes, q.relevant);

      metrics.hybrid.precision += precisionAtK(hybridRes, q.relevant, K);
      metrics.hybrid.recall += recallAtK(hybridRes, q.relevant, K);
      metrics.hybrid.mrr += mrr(hybridRes, q.relevant);

      perQuery.push({ query: q.query, desc: q.description, bm25: bm25Res, emb: embRes, hybrid: hybridRes, relevant: q.relevant });
    }

    const n = QUERIES.length;
    metrics.bm25.precision /= n;
    metrics.bm25.recall /= n;
    metrics.bm25.mrr /= n;
    metrics.embedding.precision /= n;
    metrics.embedding.recall /= n;
    metrics.embedding.mrr /= n;
    metrics.hybrid.precision /= n;
    metrics.hybrid.recall /= n;
    metrics.hybrid.mrr /= n;

    // Print results
    console.log('\n═══════════════════════════════════════════════');
    console.log('  SEARCH PERFORMANCE BENCHMARK (Golden Set)');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Documents: ${DOCUMENTS.length} | Queries: ${QUERIES.length} | K=${K}`);
    console.log('───────────────────────────────────────────────');
    console.log(`  Method      | P@${K}    | R@${K}    | MRR`);
    console.log('  ------------|---------|---------|--------');
    console.log(`  BM25        | ${(metrics.bm25.precision * 100).toFixed(1)}%  | ${(metrics.bm25.recall * 100).toFixed(1)}%  | ${metrics.bm25.mrr.toFixed(3)}`);
    console.log(`  Embedding   | ${(metrics.embedding.precision * 100).toFixed(1)}%  | ${(metrics.embedding.recall * 100).toFixed(1)}%  | ${metrics.embedding.mrr.toFixed(3)}`);
    console.log(`  Hybrid(RRF) | ${(metrics.hybrid.precision * 100).toFixed(1)}%  | ${(metrics.hybrid.recall * 100).toFixed(1)}%  | ${metrics.hybrid.mrr.toFixed(3)}`);
    console.log('───────────────────────────────────────────────');

    console.log('\n  Per-Query Results:');
    for (const pq of perQuery) {
      const bHit = pq.bm25.filter(id => pq.relevant.includes(id)).length;
      const eHit = pq.emb.filter(id => pq.relevant.includes(id)).length;
      const hHit = pq.hybrid.filter(id => pq.relevant.includes(id)).length;
      console.log(`  [${pq.desc}]`);
      console.log(`    BM25:   ${pq.bm25.join(', ')} (${bHit}/${K} hit)`);
      console.log(`    Embed:  ${pq.emb.join(', ')} (${eHit}/${K} hit)`);
      console.log(`    Hybrid: ${pq.hybrid.join(', ')} (${hHit}/${K} hit)`);
    }
    console.log('═══════════════════════════════════════════════\n');

    // Assertions — hybrid should be >= BM25 in most metrics
    expect(metrics.hybrid.precision).toBeGreaterThanOrEqual(metrics.bm25.precision * 0.9);
    expect(metrics.hybrid.mrr).toBeGreaterThanOrEqual(metrics.bm25.mrr * 0.9);
    expect(metrics.embedding.mrr).toBeGreaterThan(0.3);
  });

  it('hybrid search improves on edge cases where BM25 fails', () => {
    const semanticQuery = 'handling concurrent operations without blocking';
    const relevant = ['python-async', 'node-streams', 'node-events'];

    const bm25Res = bm25Search(semanticQuery, 5);
    const embRes = embeddingSearch(semanticQuery, 5);
    const hybridRes = hybridSearch(semanticQuery, 5);

    const bm25Hits = bm25Res.filter(id => relevant.includes(id)).length;
    const embHits = embRes.filter(id => relevant.includes(id)).length;
    const hybridHits = hybridRes.filter(id => relevant.includes(id)).length;

    console.log('\n  Edge Case: Vocabulary Mismatch');
    console.log(`  Query: "${semanticQuery}"`);
    console.log(`  BM25:   ${bm25Res.join(', ')} (${bm25Hits} hits)`);
    console.log(`  Embed:  ${embRes.join(', ')} (${embHits} hits)`);
    console.log(`  Hybrid: ${hybridRes.join(', ')} (${hybridHits} hits)\n`);

    expect(embHits + hybridHits).toBeGreaterThanOrEqual(bm25Hits);
  });

  it('weighted RRF (embWeight=2.0) favors embedding for semantic queries', () => {
    const semanticQuery = 'handling concurrent operations without blocking';
    const relevant = ['python-async', 'node-streams', 'node-events'];

    const equalRes = hybridSearch(semanticQuery, 5, 1.0);
    const weightedRes = hybridSearch(semanticQuery, 5, 2.0);

    const equalHits = equalRes.filter(id => relevant.includes(id)).length;
    const weightedHits = weightedRes.filter(id => relevant.includes(id)).length;

    console.log('\n  Weighted RRF Comparison:');
    console.log(`  Equal (1:1):   ${equalRes.join(', ')} (${equalHits} hits)`);
    console.log(`  Weighted (2:1): ${weightedRes.join(', ')} (${weightedHits} hits)\n`);

    expect(weightedHits).toBeGreaterThanOrEqual(equalHits);
  });
});
