/**
 * PrivacyRule — AI에게 전송하지 않을 콘텐츠를 정의하는 규칙.
 * 민감한 노트나 폴더를 AI 컨텍스트에서 제외한다.
 */
export interface PrivacyRule {
  readonly id: string;
  readonly name: string;
  readonly type: PrivacyRuleType;
  readonly pattern: string;
  readonly enabled: boolean;
}

export type PrivacyRuleType =
  | 'folder-exclude'      // Exclude entire folder
  | 'tag-exclude'          // Exclude notes with specific tag
  | 'frontmatter-exclude'  // Exclude notes with specific frontmatter key
  | 'content-redact';      // Mask text matching a pattern

/**
 * 주어진 규칙에 따라 노트가 AI 컨텍스트에 포함 가능한지 판단한다.
 */
export function isNoteAllowedByRules(
  notePath: string,
  noteTags: ReadonlyArray<string>,
  frontmatterEntries: Readonly<Record<string, unknown>>,
  rules: ReadonlyArray<PrivacyRule>
): boolean {
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;

    switch (rule.type) {
      case 'folder-exclude':
        if (notePath.startsWith(rule.pattern)) return false;
        break;
      case 'tag-exclude':
        if (noteTags.some(t => t === rule.pattern)) return false;
        break;
      case 'frontmatter-exclude':
        if (matchFrontmatterPattern(rule.pattern, frontmatterEntries)) return false;
        break;
      // content-redact is applied at send time (note itself is allowed)
    }
  }
  return true;
}

function matchFrontmatterPattern(
  pattern: string,
  entries: Readonly<Record<string, unknown>>,
): boolean {
  const colonIdx = pattern.indexOf(':');
  if (colonIdx === -1) {
    return Object.hasOwn(entries, pattern);
  }
  const key = pattern.slice(0, colonIdx).trim();
  const value = pattern.slice(colonIdx + 1).trim();
  if (!Object.hasOwn(entries, key)) return false;
  return String(entries[key]).trim().toLowerCase() === value.toLowerCase();
}

/**
 * content-redact 규칙에 매칭되는 패턴을 [REDACTED]로 치환한다.
 * AI 전송 직전에 호출하여 민감 정보를 마스킹한다.
 */
export function applyContentRedaction(
  text: string,
  rules: ReadonlyArray<PrivacyRule>,
): string {
  let result = text;
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'content-redact') continue;
    try {
      const regex = new RegExp(rule.pattern, 'gi');
      result = result.replace(regex, '[REDACTED]');
    } catch {
      console.warn(`[Vaultend] Invalid content-redact pattern, skipped: "${rule.pattern}"`);
    }
  }
  return result;
}
