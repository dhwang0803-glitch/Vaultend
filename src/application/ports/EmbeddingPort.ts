export interface EmbeddingPort {
  initialize(): Promise<boolean>;
  isReady(): boolean;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  getDimension(): number;
}
