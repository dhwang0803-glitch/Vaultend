/**
 * Golden Set Sanity Check
 *
 * API 없이 BM25만으로 Easy 쿼리가 정답을 찾는지 검증.
 * 실패 = 골든셋 라벨링 버그 (키워드가 문서에 없다는 뜻)
 */
import { describe, it, expect } from 'vitest';
import MiniSearch from 'minisearch';
import { GOLDEN_DOCUMENTS, GOLDEN_QUERIES, precisionAtK, recallAtK, mrr } from './golden-set';

function createBM25Index() {
  const index = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['id'],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 },
  });
  index.addAll(GOLDEN_DOCUMENTS.map(d => ({ id: d.id, title: d.title, content: d.content })));
  return index;
}

function bm25Search(index: MiniSearch, query: string, topK = 10): string[] {
  return index.search(query).slice(0, topK).map(r => r.id);
}

describe('Golden Set Sanity Check', () => {
  const index = createBM25Index();

  describe('Easy queries: BM25 must find relevant docs in top-5', () => {
    const easyQueries = GOLDEN_QUERIES.filter(q => q.difficulty === 'easy');

    for (const q of easyQueries) {
      it(`${q.id}: "${q.query}" → should find at least one relevant doc`, () => {
        const results = bm25Search(index, q.query, 5);
        const found = results.filter(id => q.relevant.includes(id));
        expect(found.length).toBeGreaterThan(0);
      });
    }
  });

  describe('Easy queries: MRR should be >= 0.5 (first relevant in top-2)', () => {
    const easyQueries = GOLDEN_QUERIES.filter(q => q.difficulty === 'easy');

    for (const q of easyQueries) {
      it(`${q.id}: MRR >= 0.5`, () => {
        const results = bm25Search(index, q.query, 10);
        const score = mrr(results, [...q.relevant]);
        expect(score).toBeGreaterThanOrEqual(0.5);
      });
    }
  });

  describe('Medium queries: BM25 should find at least one relevant in top-10', () => {
    const mediumQueries = GOLDEN_QUERIES.filter(q => q.difficulty === 'medium');

    for (const q of mediumQueries) {
      it(`${q.id}: "${q.query}" → at least partial recall`, () => {
        const results = bm25Search(index, q.query, 10);
        const recall = recallAtK(results, [...q.relevant], 10);
        // Medium은 BM25로 최소 1개는 찾아야 라벨이 유효
        expect(recall).toBeGreaterThan(0);
      });
    }
  });

  describe('Document coverage: all referenced docs exist', () => {
    const allDocIds = new Set(GOLDEN_DOCUMENTS.map(d => d.id));

    for (const q of GOLDEN_QUERIES) {
      it(`${q.id}: all relevant doc IDs exist in GOLDEN_DOCUMENTS`, () => {
        for (const docId of q.relevant) {
          expect(allDocIds.has(docId)).toBe(true);
        }
      });
    }
  });

  describe('Scoring utilities correctness', () => {
    it('precisionAtK computes correctly', () => {
      expect(precisionAtK(['a', 'b', 'c'], ['a', 'c'], 3)).toBeCloseTo(2 / 3);
      expect(precisionAtK(['a', 'b', 'c'], ['d'], 3)).toBe(0);
    });

    it('recallAtK computes correctly', () => {
      expect(recallAtK(['a', 'b', 'c'], ['a', 'c', 'd'], 3)).toBeCloseTo(2 / 3);
    });

    it('mrr computes correctly', () => {
      expect(mrr(['x', 'a', 'b'], ['a'])).toBeCloseTo(0.5);
      expect(mrr(['a', 'b', 'c'], ['a'])).toBe(1);
      expect(mrr(['x', 'y', 'z'], ['a'])).toBe(0);
    });
  });

  describe('Overall BM25 baseline metrics', () => {
    it('reports overall P@3, R@5, MRR for all queries', () => {
      const results = GOLDEN_QUERIES.map(q => {
        const retrieved = bm25Search(index, q.query, 10);
        return {
          queryId: q.id,
          difficulty: q.difficulty,
          p3: precisionAtK(retrieved, [...q.relevant], 3),
          r5: recallAtK(retrieved, [...q.relevant], 5),
          mrrScore: mrr(retrieved, [...q.relevant]),
        };
      });

      const easy = results.filter(r => r.difficulty === 'easy');
      const medium = results.filter(r => r.difficulty === 'medium');
      const hard = results.filter(r => r.difficulty === 'hard');

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

      // Easy: BM25 should excel
      const easyMrr = avg(easy.map(r => r.mrrScore));
      expect(easyMrr).toBeGreaterThanOrEqual(0.7);

      // Medium: BM25 should do okay
      const mediumMrr = avg(medium.map(r => r.mrrScore));
      expect(mediumMrr).toBeGreaterThan(0);

      // Hard: BM25 likely struggles (no strict assertion, just log)
      const hardMrr = avg(hard.map(r => r.mrrScore));

      // Console report for human review
      console.log('\n── BM25 Baseline Report ──');
      console.log(`Easy   MRR: ${(easyMrr * 100).toFixed(1)}%`);
      console.log(`Medium MRR: ${(mediumMrr * 100).toFixed(1)}%`);
      console.log(`Hard   MRR: ${(hardMrr * 100).toFixed(1)}%`);
      console.log('');
      for (const r of results) {
        const status = r.mrrScore >= 0.5 ? '✓' : r.mrrScore > 0 ? '△' : '✗';
        console.log(`  ${status} ${r.queryId.padEnd(25)} ${r.difficulty.padEnd(8)} MRR=${r.mrrScore.toFixed(3)}`);
      }
    });
  });
});
