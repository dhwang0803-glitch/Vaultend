/**
 * Gemini 모델 계열별 generationConfig 정책.
 *
 * thinking 지원 방식이 모델 계열마다 달라(2.5 = thinkingBudget, 3.x = thinkingLevel,
 * lite 계열은 기본 비활성) 잘못된 값을 보내면 HTTP 400이 발생한다.
 * 실측 근거: 2026-11-13 Gemini API 매트릭스 검증 (2.5-flash는 thinkingLevel 거부,
 * 3.5-flash-lite는 thinkingBudget:0 거부, 3.1-pro는 budget 0 거부).
 *
 * temperature는 모든 모델에 호출자가 지정한 값(분류 0.1)을 그대로 보낸다.
 * Google은 Gemini 3에서 기본값 1.0 유지를 권장하지만, 이 앱은 분류 비결정성을 줄이려고
 * 0.3→0.1로 낮춘 결정이 있고(b09eca7), 2026-11-13 실측에서도 temperature 미전송 시
 * 태그 일관성이 같거나 나빠졌으며(Jaccard 0.47→0.17 등) 0.1에서 실패·반복은 관찰되지 않았다.
 * thinking은 OpenAI reasoning 모델의 reasoning_effort: 'low' 결정(4813dfa)과 맞춰 낮게 제한한다.
 */

export type GeminiThinkingConfig =
  | { readonly thinkingBudget: number }
  | { readonly thinkingLevel: 'low' };

export interface GeminiModelProfile {
  /** thinking 토큰이 maxOutputTokens 예산을 소모하는 모델인지 */
  readonly consumesThinkingTokens: boolean;
  /** 명시적으로 보낼 thinkingConfig (없으면 모델 기본값 사용) */
  readonly thinkingConfig?: GeminiThinkingConfig;
}

interface ProfileRule {
  readonly matches: (model: string) => boolean;
  readonly profile: GeminiModelProfile;
}

const LEGACY_PROFILE: GeminiModelProfile = {
  consumesThinkingTokens: false,
};

function majorVersion(model: string): number | null {
  const match = /^gemini-(\d+)(?:\.\d+)?-/.exec(model);
  return match ? Number(match[1]) : null;
}

function isLite(model: string): boolean {
  return /-lite(?:-|$)/.test(model);
}

/** 위에서부터 첫 매칭 규칙을 적용한다. 순서가 의미를 가진다. */
const RULES: ReadonlyArray<ProfileRule> = [
  {
    // 2.5 Flash Lite: thinking 기본 비활성 — 기존 동작 유지
    matches: m => m.startsWith('gemini-2.5-') && isLite(m),
    profile: { consumesThinkingTokens: false },
  },
  {
    // 2.5 Flash: thinking 기본 활성, budget 0으로 비활성화 가능
    matches: m => m.startsWith('gemini-2.5-flash'),
    profile: { consumesThinkingTokens: true, thinkingConfig: { thinkingBudget: 0 } },
  },
  {
    // 2.5 Pro 등: thinking 비활성 불가 — 출력 여유분만 확보
    matches: m => m.startsWith('gemini-2.5-'),
    profile: { consumesThinkingTokens: true },
  },
  {
    // 3.x 이상 lite: thinking 기본 최소 — low를 보내면 오히려 thinking이 증가하므로 기본값 유지
    matches: m => (majorVersion(m) ?? 0) >= 3 && isLite(m),
    profile: { consumesThinkingTokens: true },
  },
  {
    // 3.x 이상 Flash/Pro: thinking 기본 medium~high → low로 제한
    matches: m => (majorVersion(m) ?? 0) >= 3,
    profile: { consumesThinkingTokens: true, thinkingConfig: { thinkingLevel: 'low' } },
  },
];

export class GeminiGenerationPolicy {
  /** thinking 모델에서 thinking 토큰용으로 추가 확보하는 출력 예산 */
  static readonly THINKING_HEADROOM_TOKENS = 2048;

  static resolve(model: string): GeminiModelProfile {
    const normalized = model.trim().toLowerCase().replace(/^models\//, '');
    return RULES.find(rule => rule.matches(normalized))?.profile ?? LEGACY_PROFILE;
  }

  static maxOutputTokens(profile: GeminiModelProfile, requested: number): number {
    return profile.consumesThinkingTokens
      ? requested + GeminiGenerationPolicy.THINKING_HEADROOM_TOKENS
      : requested;
  }

  /**
   * thinkingConfig를 보낸 요청이 400으로 거부됐는지 판별 (규칙에 없는 신규 모델 대비 1회 폴백용).
   * Obsidian requestUrl은 기본적으로 4xx에서 예외를 던지고 응답 본문을 버리므로
   * (statusCode 0, "Request failed, status 400") 본문 메시지에 의존하지 않고 상태 코드만 본다.
   * thinkingConfig 없이도 출력 여유분만으로 모든 계열이 정상 동작함을 실측으로 확인했으므로
   * 다른 원인의 400에 폴백이 걸려도 결과가 나빠지지 않는다.
   */
  static isBadRequest(statusCode: number, detail: string): boolean {
    if (statusCode === 400) return true;
    return statusCode === 0 && /\bstatus 400\b/.test(detail);
  }
}
