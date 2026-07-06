/** 헤딩 경로 — 노트 내 위치를 나타내는 계층적 경로 */
export type HeadingPath = string & { readonly __brand: unique symbol };

/** 예: "## 아키텍처 > ### 계층 구조" */
export function createHeadingPath(raw: string): HeadingPath {
  return raw as HeadingPath;
}
