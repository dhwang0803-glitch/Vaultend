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
    it('상수 문자열이 존재한다', () => {
      expect(PromptTemplates.classificationSystemPrompt).toBeTruthy();
      expect(PromptTemplates.classificationSystemPrompt).toContain('JSON');
    });
  });

  describe('quickAsk', () => {
    it('질문을 포함한 프롬프트를 생성한다', () => {
      const result = PromptTemplates.quickAsk('TypeScript란?', []);
      expect(result).toContain('TypeScript란?');
      expect(result).toContain('질문');
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
    it('노트 내용을 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('노트 본문입니다', []);
      expect(result).toContain('노트 본문입니다');
    });

    it('기존 태그를 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('내용', ['#dev', '#react']);
      expect(result).toContain('#dev');
      expect(result).toContain('#react');
      expect(result).toContain('기존 태그');
    });

    it('기존 태그가 없으면 태그 정보 섹션이 없다', () => {
      const result = PromptTemplates.classifyAndTag('내용', []);
      expect(result).not.toContain('기존 태그');
    });

    it('JSON 형식 가이드를 포함한다', () => {
      const result = PromptTemplates.classifyAndTag('내용', []);
      expect(result).toContain('JSON');
      expect(result).toContain('category');
      expect(result).toContain('tags');
    });
  });

  describe('suggestLinks', () => {
    it('노트 내용과 기존 노트 목록을 포함한다', () => {
      const result = PromptTemplates.suggestLinks('현재 노트', ['NoteA', 'NoteB']);
      expect(result).toContain('현재 노트');
      expect(result).toContain('NoteA');
      expect(result).toContain('NoteB');
    });

    it('빈 노트 목록도 처리한다', () => {
      const result = PromptTemplates.suggestLinks('내용', []);
      expect(result).toContain('내용');
    });
  });

  describe('summarize', () => {
    it('노트 내용을 포함한 요약 프롬프트를 생성한다', () => {
      const result = PromptTemplates.summarize('긴 노트 내용...');
      expect(result).toContain('긴 노트 내용...');
      expect(result).toContain('요약');
    });
  });
});
