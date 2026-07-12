import { describe, it, expect } from 'vitest';
import { PromptTemplates } from '../PromptTemplates';
import type { NoteChunk } from '../../domain/models/NoteChunk';
import type { ChunkText } from '../../domain/values/ChunkText';
import type { HeadingPath } from '../../domain/values/HeadingPath';

function makeChunk(text: string): NoteChunk {
  return {
    headingPath: 'Heading' as unknown as HeadingPath,
    text: text as unknown as ChunkText,
    startLine: 0,
    endLine: 1,
  };
}

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

  describe('quickAsk', () => {
    it('한국어 질문에 한국어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.quickAsk('타입스크립트란 무엇인가요?', []);
      expect(result).toContain('타입스크립트란 무엇인가요?');
      expect(result).toContain('질문');
    });

    it('영어 질문에 영어 프롬프트를 생성한다', () => {
      const result = PromptTemplates.quickAsk('What is TypeScript?', []);
      expect(result).toContain('What is TypeScript?');
      expect(result).toContain('Question');
    });

    it('컨텍스트 청크를 포함한다', () => {
      const chunks = [makeChunk('첫 번째 청크'), makeChunk('두 번째 청크')];
      const result = PromptTemplates.quickAsk('질문', chunks);
      expect(result).toContain('첫 번째 청크');
      expect(result).toContain('두 번째 청크');
      expect(result).toContain('컨텍스트 1');
      expect(result).toContain('컨텍스트 2');
    });

    it('컨텍스트가 없으면 컨텍스트 섹션이 비어있다', () => {
      const result = PromptTemplates.quickAsk('질문', []);
      expect(result).not.toContain('관련 노트 컨텍스트');
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

    it('JSON 형식 가이드를 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('내용', []);
      expect(result).toContain('JSON');
      expect(result).toContain('category');
      expect(result).toContain('tags');
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
      expect(result).toContain('related notes');
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
