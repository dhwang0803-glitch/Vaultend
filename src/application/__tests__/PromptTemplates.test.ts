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
  });

  describe('classifyAndTag', () => {
    it('한국어 노트에 한국어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.classifyAndTag('노트 본문입니다', []);
      expect(result).toContain('노트 본문입니다');
      expect(result).toContain('분석 절차');
    });

    it('영어 노트에 영어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.classifyAndTag('This is my note about React hooks', []);
      expect(result).toContain('This is my note about React hooks');
      expect(result).toContain('Analysis procedure');
    });

    it('기존 태그를 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('내용', ['#dev', '#react']);
      expect(result).toContain('#dev');
      expect(result).toContain('#react');
      expect(result).toContain('기존 태그');
    });

    it('영어 노트에서 기존 태그를 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('Content about programming', ['#dev', '#react']);
      expect(result).toContain('#dev');
      expect(result).toContain('#react');
      expect(result).toContain('existing tags');
    });

    it('JSON 형식 가이드를 포함한다 (score/isNew/reason)', () => {
      const result = PromptTemplates.classifyAndTag('내용', []);
      expect(result).toContain('JSON');
      expect(result).toContain('tags');
      expect(result).toContain('"score"');
      expect(result).toContain('"isNew"');
      expect(result).toContain('"reason"');
    });

    it('영어 프롬프트에도 score/isNew/reason 형식을 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('Content about programming', [], 'en');
      expect(result).toContain('"score": 92');
      expect(result).toContain('"isNew": false');
      expect(result).toContain('"reason"');
      expect(result).not.toContain('"confidence": 0.92');
    });

    it('locale 파라미터가 content 언어 감지를 오버라이드한다', () => {
      const result = PromptTemplates.classifyAndTag('English content with code samples', [], 'ko');
      expect(result).toContain('분석 절차');
      expect(result).toContain('한국어로');
    });

    it('locale=en이면 영어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.classifyAndTag('한글 노트인데 영어 설정', [], 'en');
      expect(result).toContain('Analysis procedure');
      expect(result).toContain('in English');
    });

    it('availableNotes가 있으면 링크 섹션을 포함한다 (EN)', () => {
      const result = PromptTemplates.classifyAndTag('Content about React', [], 'en', ['React Patterns', 'TypeScript Guide']);
      expect(result).toContain('Available notes for linking');
      expect(result).toContain('- React Patterns');
      expect(result).toContain('- TypeScript Guide');
      expect(result).toContain('relatedNotes');
    });

    it('availableNotes가 있으면 링크 섹션을 포함한다 (KO)', () => {
      const result = PromptTemplates.classifyAndTag('리액트 노트', [], 'ko', ['리액트 패턴', '타입스크립트']);
      expect(result).toContain('링크 가능한 노트 목록');
      expect(result).toContain('- 리액트 패턴');
      expect(result).toContain('relatedNotes');
    });

    it('availableNotes가 없으면 링크 섹션을 생략한다', () => {
      const result = PromptTemplates.classifyAndTag('Content', [], 'en');
      expect(result).not.toContain('Available notes for linking');
      expect(result).not.toContain('relatedNotes');
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
