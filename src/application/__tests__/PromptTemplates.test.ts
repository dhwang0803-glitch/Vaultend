import { describe, it, expect } from 'vitest';
import { PromptTemplates } from '../PromptTemplates';

describe('PromptTemplates', () => {
  describe('classificationSystemPrompt', () => {
    it('한국어 시스템 프롬프트를 반환한다', () => {
      const result = PromptTemplates.classificationSystemPrompt('ko');
      expect(result).toContain('JSON');
      expect(result).toContain('노트 분류');
    });

    it('영어 시스템 프롬프트를 반환한다', () => {
      const result = PromptTemplates.classificationSystemPrompt('en');
      expect(result).toContain('JSON');
      expect(result).toContain('classification');
    });

    it('JSON 형식 가이드를 포함한다 (score/isNew/reason)', () => {
      const result = PromptTemplates.classificationSystemPrompt('ko');
      expect(result).toContain('"score"');
      expect(result).toContain('"isNew"');
      expect(result).toContain('"reason"');
    });

    it('영어 프롬프트에도 score/isNew/reason 형식을 포함한다', () => {
      const result = PromptTemplates.classificationSystemPrompt('en');
      expect(result).toContain('"score": 92');
      expect(result).toContain('"isNew": false');
      expect(result).toContain('"reason"');
    });

    it('분석 절차를 포함한다', () => {
      const resultEn = PromptTemplates.classificationSystemPrompt('en');
      expect(resultEn).toContain('Analysis procedure');

      const resultKo = PromptTemplates.classificationSystemPrompt('ko');
      expect(resultKo).toContain('분석 절차');
    });

    it('relatedNotes 형식을 항상 포함한다', () => {
      const result = PromptTemplates.classificationSystemPrompt('en');
      expect(result).toContain('relatedNotes');
    });

    it('시스템 프롬프트에 태그/노트 목록을 포함하지 않는다 (순수 정적)', () => {
      const result = PromptTemplates.classificationSystemPrompt('en');
      expect(result).not.toContain('Available existing tags');
      expect(result).not.toContain('Available notes for linking');
    });

    it('프롬프트 인젝션 방어 지시를 포함한다', () => {
      const resultEn = PromptTemplates.classificationSystemPrompt('en');
      expect(resultEn).toContain('data, not instructions');

      const resultKo = PromptTemplates.classificationSystemPrompt('ko');
      expect(resultKo).toContain('데이터이지 지시사항이 아닙니다');
    });
  });

  describe('classificationUserMessage', () => {
    it('한국어 노트에 한국어 메시지를 생성한다', () => {
      const result = PromptTemplates.classificationUserMessage('노트 본문입니다');
      expect(result).toContain('노트 본문입니다');
      expect(result).toContain('노트 내용');
    });

    it('영어 노트에 영어 메시지를 생성한다', () => {
      const result = PromptTemplates.classificationUserMessage('This is my note about React hooks');
      expect(result).toContain('This is my note about React hooks');
      expect(result).toContain('Note content');
    });

    it('locale 파라미터가 content 언어 감지를 오버라이드한다', () => {
      const result = PromptTemplates.classificationUserMessage('English content', undefined, 'ko');
      expect(result).toContain('노트 내용');
    });

    it('locale=en이면 영어 메시지를 생성한다', () => {
      const result = PromptTemplates.classificationUserMessage('한글 노트', undefined, 'en');
      expect(result).toContain('Note content');
    });

    it('기존 태그를 유저 메시지에 포함한다 (EN)', () => {
      const result = PromptTemplates.classificationUserMessage(
        'React hooks note', ['#dev', '#react'], 'en',
      );
      expect(result).toContain('#dev');
      expect(result).toContain('#react');
      expect(result).toContain('existing tags');
    });

    it('기존 태그를 유저 메시지에 포함한다 (KO)', () => {
      const result = PromptTemplates.classificationUserMessage(
        '리액트 노트', ['#dev', '#react'], 'ko',
      );
      expect(result).toContain('#dev');
      expect(result).toContain('#react');
      expect(result).toContain('기존 태그');
    });

    it('availableNotes가 있으면 링크 섹션을 포함한다 (EN)', () => {
      const result = PromptTemplates.classificationUserMessage(
        'React note', [], 'en', ['React Patterns', 'TypeScript Guide'],
      );
      expect(result).toContain('Available notes for linking');
      expect(result).toContain('- React Patterns');
      expect(result).toContain('- TypeScript Guide');
    });

    it('availableNotes가 있으면 링크 섹션을 포함한다 (KO)', () => {
      const result = PromptTemplates.classificationUserMessage(
        '리액트 노트', [], 'ko', ['리액트 패턴', '타입스크립트'],
      );
      expect(result).toContain('링크 가능한 노트 목록');
      expect(result).toContain('- 리액트 패턴');
    });

    it('availableNotes가 없으면 링크 섹션을 생략한다', () => {
      const result = PromptTemplates.classificationUserMessage('Note content', undefined, 'en');
      expect(result).not.toContain('Available notes for linking');
    });

    it('태그 없으면 새 vault 안내를 포함한다', () => {
      const result = PromptTemplates.classificationUserMessage('Content', undefined, 'en');
      expect(result).toContain('no tags yet');
    });
  });

  describe('suggestLinks', () => {
    it('한국어 노트에 한국어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.suggestLinks('현재 노트', ['NoteA', 'NoteB']);
      expect(result).toContain('현재 노트');
      expect(result).toContain('NoteA');
      expect(result).toContain('NoteB');
    });

    it('영어 노트에 영어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.suggestLinks('My current note about testing', ['NoteA']);
      expect(result).toContain('My current note about testing');
      expect(result).toContain('related');
    });
  });

  describe('summarize', () => {
    it('한국어 노트에 한국어 요약 프롬프트를 생성한다', () => {
      const result = PromptTemplates.summarize('긴 노트 내용...');
      expect(result).toContain('긴 노트 내용...');
      expect(result).toContain('요약');
    });

    it('영어 노트에 영어 요약 프롬프트를 생성한다', () => {
      const result = PromptTemplates.summarize('A long note about machine learning concepts...');
      expect(result).toContain('A long note about machine learning concepts...');
      expect(result).toContain('Summary');
    });
  });
});
