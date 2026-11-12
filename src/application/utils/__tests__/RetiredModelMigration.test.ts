import { describe, it, expect } from 'vitest';
import { RetiredModelMigration } from '../RetiredModelMigration';

describe('RetiredModelMigration — 종료 모델만 교체', () => {
  it.each([
    ['o4-mini', 'gpt-5.6-terra'],
    ['o3-mini', 'gpt-5.6-sol'],
    ['o1', 'gpt-5.6-sol'],
    ['gpt-4.1-nano', 'gpt-5.6-luna'],
    ['o4-mini-2025-04-16', 'gpt-5.6-terra'],
    ['gpt-4.1-nano-2025-04-14', 'gpt-5.6-luna'],
    [' O3-Mini ', 'gpt-5.6-sol'],
  ])('openai: %s → %s', (from, to) => {
    const data: Record<string, unknown> = { aiProvider: 'openai', aiModel: from };
    expect(RetiredModelMigration.apply(data)).toBe(true);
    expect(data.aiModel).toBe(to);
  });

  it('aiProvider가 저장되지 않은 경우(기본 openai)도 교체한다', () => {
    const data: Record<string, unknown> = { aiModel: 'o4-mini' };
    RetiredModelMigration.apply(data);
    expect(data.aiModel).toBe('gpt-5.6-terra');
  });

  it('gemini: text-embedding-004 → 빈 값(프로바이더 기본 gemini-embedding-001)', () => {
    const data: Record<string, unknown> = { aiProvider: 'gemini', aiModel: 'gemini-2.5-flash', embeddingsModel: 'text-embedding-004' };
    expect(RetiredModelMigration.apply(data)).toBe(true);
    expect(data.embeddingsModel).toBe('');
    expect(data.aiModel).toBe('gemini-2.5-flash');
  });
});

describe('RetiredModelMigration — 동작하는 값은 절대 건드리지 않는다', () => {
  it.each([
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-luna', 'gpt-6.1-sol',
    'o1-pro', 'o4-mini-deep-research', 'my-finetune', '',
  ])('openai 모델 %s 유지', (model) => {
    const data: Record<string, unknown> = { aiProvider: 'openai', aiModel: model, embeddingsModel: 'text-embedding-3-small' };
    const before = { ...data };
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('custom 엔드포인트는 프록시일 수 있으므로 종료 모델 ID여도 유지', () => {
    const data: Record<string, unknown> = { aiProvider: 'custom', aiModel: 'o4-mini', customModel: 'o3-mini', embeddingsModel: 'text-embedding-004' };
    const before = { ...data };
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('ollama 프로바이더의 aiModel은 유지 (로컬 모델명 충돌 방지)', () => {
    const data: Record<string, unknown> = { aiProvider: 'ollama', aiModel: 'o1' };
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data.aiModel).toBe('o1');
  });

  it('gemini 프로바이더의 동작 중인 임베딩 모델 유지', () => {
    for (const m of ['gemini-embedding-001', 'gemini-embedding-2', '']) {
      const data: Record<string, unknown> = { aiProvider: 'gemini', embeddingsModel: m };
      expect(RetiredModelMigration.apply(data)).toBe(false);
      expect(data.embeddingsModel).toBe(m);
    }
  });

  it('openai 프로바이더의 임베딩 설정은 대상이 아니다', () => {
    const data: Record<string, unknown> = { aiProvider: 'openai', aiModel: 'gpt-4o', embeddingsModel: 'text-embedding-ada-002' };
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data.embeddingsModel).toBe('text-embedding-ada-002');
  });

  it('빈 설정(신규 설치)에는 아무 필드도 추가하지 않는다', () => {
    const data: Record<string, unknown> = {};
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data).toEqual({});
  });

  it('gemini-2.5-pro는 종료 전까지 유지 (12/1 이후 별도 처리)', () => {
    const data: Record<string, unknown> = { aiProvider: 'gemini', aiModel: 'gemini-2.5-pro' };
    expect(RetiredModelMigration.apply(data)).toBe(false);
    expect(data.aiModel).toBe('gemini-2.5-pro');
  });
});
