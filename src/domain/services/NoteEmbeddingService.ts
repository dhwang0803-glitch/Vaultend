import { NotePath } from '../values/NotePath';
import { TagNormalizationService } from './TagNormalizationService';

export interface WeightedEmbeddingConfig {
  readonly titleWeight: number;
  readonly bodyWeight: number;
}

export interface LinkCandidate {
  readonly notePath: NotePath;
  readonly similarity: number;
}

export class NoteEmbeddingService {
  static readonly DEFAULT_CONFIG: WeightedEmbeddingConfig = {
    titleWeight: 0.2,
    bodyWeight: 0.8,
  };

  static readonly SIMILARITY_THRESHOLD = 0.85;
  static readonly MAX_LINK_SUGGESTIONS = 5;

  static combineEmbeddings(
    titleEmbedding: Float32Array,
    bodyEmbedding: Float32Array,
    config: WeightedEmbeddingConfig = NoteEmbeddingService.DEFAULT_CONFIG,
  ): Float32Array {
    if (titleEmbedding.length !== bodyEmbedding.length) {
      throw new Error(
        `Embedding dimension mismatch: title=${titleEmbedding.length}, body=${bodyEmbedding.length}`,
      );
    }

    const dim = titleEmbedding.length;
    const result = new Float32Array(dim);
    let normSq = 0;

    for (let i = 0; i < dim; i++) {
      result[i] = config.titleWeight * titleEmbedding[i] + config.bodyWeight * bodyEmbedding[i];
      normSq += result[i] * result[i];
    }

    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        result[i] /= norm;
      }
    }

    return result;
  }

  static findSimilarNotes(
    targetEmbedding: Float32Array,
    candidateEmbeddings: ReadonlyMap<NotePath, Float32Array>,
    threshold: number = NoteEmbeddingService.SIMILARITY_THRESHOLD,
    maxResults: number = NoteEmbeddingService.MAX_LINK_SUGGESTIONS,
  ): ReadonlyArray<LinkCandidate> {
    const candidates: LinkCandidate[] = [];

    for (const [notePath, embedding] of candidateEmbeddings) {
      const similarity = TagNormalizationService.cosineSimilarity(targetEmbedding, embedding);
      if (similarity >= threshold) {
        candidates.push({ notePath, similarity });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, maxResults);
  }

  static async computeContentHash(title: string, body: string): Promise<string> {
    const data = new TextEncoder().encode(title + '\n' + body);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
