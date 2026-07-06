/** Vault 루트 기준 상대 경로 */
export type NotePath = string & { readonly __brand: unique symbol };

export function createNotePath(raw: string): NotePath {
  if (!raw.endsWith('.md')) {
    throw new Error('NotePath는 .md 확장자로 끝나야 합니다');
  }
  return raw as NotePath;
}

export function notePathToString(path: NotePath): string {
  return path as string;
}
