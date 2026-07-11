import { describe, it, expect, vi } from 'vitest';
import { OrganizeNoteUseCase } from '../OrganizeNoteUseCase';
import { createMockVault, createMockAI, createMockHistory, createMockConfig } from '../../../test-utils/mock-ports';
import { createTestNote, createTestMetadata } from '../../../test-utils/fixtures';
import { NoteNotFoundError } from '../../../domain/errors/DomainErrors';
import type { NotePath } from '../../../domain/values/NotePath';
import type { TagName } from '../../../domain/values/TagName';
import type { ClassificationResponse } from '../../ports/AIProviderPort';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

describe('OrganizeNoteUseCase', () => {
  function makeClassification(overrides?: Partial<ClassificationResponse>): ClassificationResponse {
    return {
      category: 'technology',
      suggestedTags: ['#typescript'],
      suggestedFolder: undefined,
      summary: 'A note about TypeScript',
      confidence: 0.9,
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
      ...overrides,
    };
  }

  describe('execute', () => {
    it('노트가 없으면 NoteNotFoundError를 던진다', async () => {
      const vault = createMockVault({ readNote: vi.fn().mockResolvedValue(null) });
      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());

      await expect(uc.execute(np('missing.md'), false)).rejects.toThrow(NoteNotFoundError);
    });

    it('AI 분류 결과를 OrganizeResult로 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote()),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification()),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.classifiedCategory).toBe('technology');
      expect(result.addedTags.map(t => t as string)).toContain('#typescript');
      expect(result.summary).toBe('A note about TypeScript');
    });

    it('autoApply=false면 vault에 변경을 수행하지 않는다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote()),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification({ suggestedTags: ['#newtag'] })),
      });
      const history = createMockHistory();

      const uc = new OrganizeNoteUseCase(ai, vault, history, createMockConfig());
      await uc.execute(np('test.md'), false);

      expect(vault.updateFrontmatter).not.toHaveBeenCalled();
      expect(vault.writeNote).not.toHaveBeenCalled();
      expect(vault.deleteNote).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });
  });

  describe('findRelevantLinks (via execute)', () => {
    it('콘텐츠에 다른 노트 basename이 포함되면 링크를 제안한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'This is about TypeScript and React patterns.' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('docs/TypeScript.md'), np('React.md')]),
      });

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).toContain('docs/TypeScript.md');
      expect(result.suggestedLinks.map(l => l as string)).toContain('React.md');
    });

    it('자기 자신은 제외한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'test-note is self-referencing' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('folder/test-note.md')]),
      });

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('folder/test-note.md'), false);

      expect(result.suggestedLinks).toHaveLength(0);
    });

    it('basename이 3글자 미만인 노트는 건너뛴다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'content with ab' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('ab.md')]),
      });

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).not.toContain('ab.md');
    });

    it('대소문자 무시하여 매칭한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'I use REACT for frontend.' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('react.md')]),
      });

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).toContain('react.md');
    });
  });

  describe('content-redact (via execute)', () => {
    it('content-redact 규칙이 있으면 AI에 보내는 텍스트에서 패턴이 마스킹된다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'my password:secret123 is here' }),
        ),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue({
          category: 'tech',
          suggestedTags: [],
          suggestedFolder: undefined,
          summary: '',
          confidence: 0.9,
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
        }),
      });
      const config = createMockConfig({
        privacyRules: [{
          id: '1',
          name: 'redact-passwords',
          type: 'content-redact',
          pattern: 'password:\\S+',
          enabled: true,
        }],
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), config);
      await uc.execute(np('test.md'), false);

      const callArgs = (ai.callClassification as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.text).toContain('[REDACTED]');
      expect(callArgs.text).not.toContain('password:secret123');
    });
  });

  describe('applyOrganization (via autoApply=true)', () => {
    it('태그를 추가한다 (중복 제거)', async () => {
      const note = createTestNote({
        metadata: createTestMetadata({
          tags: ['#existing'] as unknown as ReadonlyArray<TagName>,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(note),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedTags: ['#existing', '#newtag'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      await uc.execute(np('test.md'), true);

      expect(vault.updateFrontmatter).toHaveBeenCalledWith(
        np('test.md'),
        expect.objectContaining({
          tags: expect.arrayContaining(['#existing', '#newtag']),
        }),
      );
    });

    it('Related Notes 섹션을 추가한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'Content about React' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('React.md')]),
      });

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, createMockHistory(), createMockConfig());
      await uc.execute(np('test.md'), true);

      expect(vault.writeNote).toHaveBeenCalledWith(
        np('test.md'),
        expect.stringContaining('## Related Notes'),
      );
      expect(vault.writeNote).toHaveBeenCalledWith(
        np('test.md'),
        expect.stringContaining('[[React]]'),
      );
    });

    it('suggestedFolder가 있으면 노트를 해당 폴더로 이동한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'content' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('Projects/existing.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedFolder: 'Projects', suggestedTags: [] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      await uc.execute(np('inbox/note.md'), true);

      expect(vault.writeNote).toHaveBeenCalledWith(np('Projects/note.md'), 'content');
      expect(vault.deleteNote).toHaveBeenCalledWith(np('inbox/note.md'));
    });

    it('이력을 기록한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote()),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const history = createMockHistory();

      const uc = new OrganizeNoteUseCase(createMockAI(), vault, history, createMockConfig());
      await uc.execute(np('test.md'), true);

      expect(history.record).toHaveBeenCalledTimes(1);
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'classify' }),
      );
    });
  });
});
