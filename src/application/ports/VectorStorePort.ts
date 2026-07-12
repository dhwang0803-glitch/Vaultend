import { NotePath } from '../../domain/values/NotePath';

export interface VectorSearchResult {
  readonly notePath: NotePath;
  readonly chunkIndex: number;
  readonly similarity: number;
}

export interface VectorStorePort {
  upsert(notePath: NotePath, chunkIndex: number, vector: Float32Array): Promise<void>;
  remove(notePath: NotePath): Promise<void>;
  search(queryVector: Float32Array, topK: number): Promise<ReadonlyArray<VectorSearchResult>>;
  flush(): Promise<void>;
  load(): Promise<void>;
  clear(): Promise<void>;
}
