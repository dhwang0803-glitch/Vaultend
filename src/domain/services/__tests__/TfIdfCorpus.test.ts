import { describe, it, expect } from 'vitest';
import { TfIdfCorpus } from '../TfIdfCorpus';

describe('TfIdfCorpus', () => {
  it('adds a document and tracks count', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);
    expect(corpus.getDocumentCount()).toBe(1);
    expect(corpus.hasDocument('doc1')).toBe(true);
  });

  it('removes a document and decrements count', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);
    corpus.removeDocument('doc1');
    expect(corpus.getDocumentCount()).toBe(0);
    expect(corpus.hasDocument('doc1')).toBe(false);
  });

  it('re-adding the same document replaces it', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);
    corpus.addDocument('doc1', ['foo', 'bar']);
    expect(corpus.getDocumentCount()).toBe(1);
  });

  it('computes TF-IDF vector with correct IDF weighting', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['apple', 'banana', 'apple']);
    corpus.addDocument('doc2', ['banana', 'cherry']);

    const vec = corpus.computeTfIdfVector(['apple', 'banana', 'apple']);
    // apple appears in 1 doc (df=1), banana in 2 docs (df=2)
    // apple should have higher IDF than banana
    expect(vec.get('apple')!).toBeGreaterThan(vec.get('banana')!);
  });

  it('cosine similarity of identical vectors is 1.0', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);

    const vec = corpus.computeTfIdfVector(['hello', 'world']);
    expect(corpus.cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
  });

  it('cosine similarity of orthogonal vectors is 0.0', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);
    corpus.addDocument('doc2', ['foo', 'bar']);

    const vecA = corpus.computeTfIdfVector(['hello', 'world']);
    const vecB = corpus.computeTfIdfVector(['foo', 'bar']);
    expect(corpus.cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it('similar documents have high cosine similarity', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['react', 'hooks', 'component', 'state', 'useEffect']);
    corpus.addDocument('doc2', ['react', 'hooks', 'state', 'useState', 'component']);
    corpus.addDocument('doc3', ['python', 'django', 'model', 'database', 'orm']);

    const vec1 = corpus.computeTfIdfVector(['react', 'hooks', 'component', 'state', 'useEffect']);
    const vec2 = corpus.computeTfIdfVector(['react', 'hooks', 'state', 'useState', 'component']);
    const vec3 = corpus.computeTfIdfVector(['python', 'django', 'model', 'database', 'orm']);

    const sim12 = corpus.cosineSimilarity(vec1, vec2);
    const sim13 = corpus.cosineSimilarity(vec1, vec3);

    expect(sim12).toBeGreaterThan(0.5);
    expect(sim13).toBeLessThan(0.1);
  });

  it('empty vector returns 0 cosine similarity', () => {
    const corpus = new TfIdfCorpus();
    const empty = new Map<string, number>();
    const nonEmpty = new Map<string, number>([['a', 1.0]]);
    expect(corpus.cosineSimilarity(empty, nonEmpty)).toBe(0);
  });

  it('serializes and deserializes stats correctly', () => {
    const corpus = new TfIdfCorpus();
    corpus.addDocument('doc1', ['hello', 'world']);
    corpus.addDocument('doc2', ['hello', 'there']);

    const stats = corpus.getStats();
    const restored = new TfIdfCorpus();
    restored.loadFromStats(stats);

    expect(restored.getDocumentCount()).toBe(2);
    expect(restored.hasDocument('doc1')).toBe(true);
    expect(restored.hasDocument('doc2')).toBe(true);

    const vec1 = corpus.computeTfIdfVector(['hello', 'world']);
    const vec1Restored = restored.computeTfIdfVector(['hello', 'world']);
    expect(corpus.cosineSimilarity(vec1, vec1Restored)).toBeCloseTo(1.0);
  });
});
