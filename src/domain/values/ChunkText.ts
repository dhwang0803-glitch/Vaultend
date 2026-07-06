/** 노트의 한 섹션(청크)에 해당하는 텍스트 */
export type ChunkText = string & { readonly __brand: unique symbol };

export function createChunkText(raw: string): ChunkText {
  return raw as ChunkText;
}
