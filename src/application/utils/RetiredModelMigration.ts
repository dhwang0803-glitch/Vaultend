/**
 * 제공사가 종료(shutdown)한 모델 ID가 저장된 설정을 대체 모델로 교체한다.
 *
 * 원칙: 이미 API가 거부하는(동작하지 않는) 값만 교체한다. 동작 중인 값은 절대 건드리지 않는다.
 * - aiModel: aiProvider가 'openai'일 때만 (custom 엔드포인트는 프록시일 수 있어 제외)
 * - embeddingsModel: aiProvider가 'gemini'일 때만, '' 로 비워 프로바이더 기본값(gemini-embedding-001)을 따르게 함
 *
 * 대체 모델은 OpenAI 공식 deprecations 페이지의 권장 대체(2026-11-13 확인)를 따른다.
 * 실측: 2026-11-13 o4-mini / o3-mini / gpt-4.1-nano 404 "has been deprecated",
 *       text-embedding-004 404 (2026-01-14 종료).
 */

type SettingsRecord = Record<string, unknown>;

export class RetiredModelMigration {
  static readonly OPENAI_CHAT_REPLACEMENTS: Readonly<Record<string, string>> = {
    'o4-mini': 'gpt-5.6-terra',
    'o3-mini': 'gpt-5.6-sol',
    'o1': 'gpt-5.6-sol',
    'gpt-4.1-nano': 'gpt-5.6-luna',
  };

  static readonly GEMINI_RETIRED_EMBEDDINGS: ReadonlySet<string> = new Set(['text-embedding-004']);

  /**
   * data를 제자리에서 수정한다(loadSettings의 기존 레거시 마이그레이션과 동일 패턴).
   * @returns 교체가 하나라도 일어났는지
   */
  static apply(data: SettingsRecord): boolean {
    const provider = typeof data.aiProvider === 'string' ? data.aiProvider : 'openai';
    let changed = false;

    if (provider === 'openai' && typeof data.aiModel === 'string') {
      const replacement = RetiredModelMigration.OPENAI_CHAT_REPLACEMENTS[RetiredModelMigration.baseId(data.aiModel)];
      if (replacement) {
        data.aiModel = replacement;
        changed = true;
      }
    }

    if (provider === 'gemini' && typeof data.embeddingsModel === 'string'
      && RetiredModelMigration.GEMINI_RETIRED_EMBEDDINGS.has(data.embeddingsModel.trim().toLowerCase())) {
      data.embeddingsModel = '';
      changed = true;
    }

    return changed;
  }

  /** 'o4-mini-2025-04-16' 같은 날짜 스냅샷 접미사를 제거하고 소문자로 정규화 */
  private static baseId(model: string): string {
    return model.trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '');
  }
}
