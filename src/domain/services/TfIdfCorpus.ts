export interface TfIdfCorpusStats {
  documentCount: number;
  documentFrequency: Record<string, number>;
  documentTokens: Record<string, string[]>;
}

export class TfIdfCorpus {
  private documentFrequency: Map<string, number> = new Map();
  private documentTokens: Map<string, Set<string>> = new Map();
  private documentCount = 0;

  addDocument(docId: string, tokens: string[]): void {
    this.removeDocument(docId);

    const uniqueTokens = new Set(tokens);
    this.documentTokens.set(docId, uniqueTokens);
    this.documentCount++;

    for (const token of uniqueTokens) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
    }
  }

  removeDocument(docId: string): void {
    const existingTokens = this.documentTokens.get(docId);
    if (!existingTokens) return;

    for (const token of existingTokens) {
      const count = (this.documentFrequency.get(token) ?? 1) - 1;
      if (count <= 0) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, count);
      }
    }

    this.documentTokens.delete(docId);
    this.documentCount--;
  }

  computeTfIdfVector(tokens: string[]): Map<string, number> {
    const vector = new Map<string, number>();
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    const totalTerms = tokens.length;
    if (totalTerms === 0) return vector;

    for (const [term, count] of termFreq) {
      const tf = count / totalTerms;
      const df = this.documentFrequency.get(term) ?? 0;
      const idf = df > 0 ? Math.log((this.documentCount + 1) / (df + 1)) + 1 : 0;
      const tfidf = tf * idf;
      if (tfidf > 0) {
        vector.set(term, tfidf);
      }
    }

    return vector;
  }

  cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
    if (vecA.size === 0 || vecB.size === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const [term, valA] of vecA) {
      normA += valA * valA;
      const valB = vecB.get(term);
      if (valB !== undefined) {
        dotProduct += valA * valB;
      }
    }

    for (const [, valB] of vecB) {
      normB += valB * valB;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  getStats(): TfIdfCorpusStats {
    const documentTokens: Record<string, string[]> = {};
    for (const [docId, tokens] of this.documentTokens) {
      documentTokens[docId] = [...tokens];
    }

    return {
      documentCount: this.documentCount,
      documentFrequency: Object.fromEntries(this.documentFrequency),
      documentTokens,
    };
  }

  loadFromStats(stats: TfIdfCorpusStats): void {
    this.documentCount = stats.documentCount;
    this.documentFrequency = new Map(Object.entries(stats.documentFrequency));
    this.documentTokens = new Map();
    for (const [docId, tokens] of Object.entries(stats.documentTokens)) {
      this.documentTokens.set(docId, new Set(tokens));
    }
  }

  getDocumentCount(): number {
    return this.documentCount;
  }

  hasDocument(docId: string): boolean {
    return this.documentTokens.has(docId);
  }
}
