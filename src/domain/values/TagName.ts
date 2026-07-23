/** 태그 이름 — '#' 접두사 포함 */
export type TagName = string & { readonly __brand: unique symbol };

/**
 * AI가 반환한 태그 문자열을 정규화한다.
 * 공백·특수문자를 하이픈으로 치환하여 유효한 Obsidian 태그 형식으로 변환.
 */
export function sanitizeTagName(raw: string): string {
  const s = raw.trim();
  const hasHash = s.startsWith('#');
  const body = hasHash ? s.slice(1) : s;
  const sanitized = body
    .replace(/#/g, '')
    .replace(/[^\w가-힣\-/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return `#${sanitized}`;
}

export function normalizeNestedTag(raw: string): string {
  const hasHash = raw.startsWith('#');
  const body = hasHash ? raw.slice(1) : raw;
  const cleaned = body.replace(/#/g, '');
  return `#${cleaned}`;
}

export function createTagName(raw: string): TagName {
  const normalized = normalizeNestedTag(raw);
  if (!/^#[\w가-힣\-/]+$/.test(normalized)) {
    throw new Error(`유효하지 않은 태그 이름: ${raw}`);
  }
  return normalized as TagName;
}
