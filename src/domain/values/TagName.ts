/** 태그 이름 — '#' 접두사 포함 */
export type TagName = string & { readonly __brand: unique symbol };

export function createTagName(raw: string): TagName {
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#[\w가-힣\-/]+$/.test(normalized)) {
    throw new Error(`유효하지 않은 태그 이름: ${raw}`);
  }
  return normalized as TagName;
}
