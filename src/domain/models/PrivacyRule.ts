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
  | 'folder-exclude'      // 특정 폴더 전체 제외
  | 'tag-exclude'          // 특정 태그가 달린 노트 제외
  | 'frontmatter-exclude'  // 특정 frontmatter 키가 있는 노트 제외
  | 'content-redact';      // 특정 패턴의 텍스트를 마스킹

/**
 * 주어진 규칙에 따라 노트가 AI 컨텍스트에 포함 가능한지 판단한다.
 */
export function isNoteAllowedByRules(
  notePath: string,
  noteTags: ReadonlyArray<string>,
  frontmatterKeys: ReadonlyArray<string>,
  rules: ReadonlyArray<PrivacyRule>
): boolean {
  for (const rule of rules) {
    if (!rule.enabled) continue;

    switch (rule.type) {
      case 'folder-exclude':
        if (notePath.startsWith(rule.pattern)) return false;
        break;
      case 'tag-exclude':
        if (noteTags.some(t => t === rule.pattern)) return false;
        break;
      case 'frontmatter-exclude':
        if (frontmatterKeys.includes(rule.pattern)) return false;
        break;
      // content-redact는 전송 시점에 처리 (노트 자체는 허용)
    }
  }
  return true;
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
      console.warn(`[Knowledge Maintenance] content-redact 패턴 오류, 건너뜀: "${rule.pattern}"`);
    }
  }
  return result;
}
