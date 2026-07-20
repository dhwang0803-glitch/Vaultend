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
      suggestedLinks: [],
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

  describe('link validation (via execute)', () => {
    it('AI가 제안한 링크 중 vault에 존재하는 것만 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'This is about TypeScript and React patterns.' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('docs/TypeScript.md'), np('React.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['docs/TypeScript', 'React'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).toContain('docs/TypeScript.md');
      expect(result.suggestedLinks.map(l => l as string)).toContain('React.md');
    });

    it('AI가 hallucinate한 노트는 필터링된다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'some content' })),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('React.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['React', 'NonExistentNote', 'FakeNote'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).toEqual(['React.md']);
    });

    it('자기 자신은 제외된다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'self reference' })),
        listNotes: vi.fn().mockResolvedValue([np('folder/test-note.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['folder/test-note'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('folder/test-note.md'), false);

      expect(result.suggestedLinks).toHaveLength(0);
    });

    it('basename 매칭으로 full path를 복원한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'content about react' })),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('frameworks/react.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['react'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks.map(l => l as string)).toContain('frameworks/react.md');
    });

    it('중복된 제안은 하나만 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'content' })),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('React.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['React', 'react', 'React.md'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks).toHaveLength(1);
    });

    it('suggestedLinks가 없으면 빈 배열을 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'content' })),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('other.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: undefined }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.suggestedLinks).toHaveLength(0);
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
        callClassification: vi.fn().mockResolvedValue(makeClassification({
          suggestedTags: [],
        })),
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
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(
          makeClassification({ suggestedLinks: ['React'] }),
        ),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
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
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification()),
      });
      const history = createMockHistory();

      const uc = new OrganizeNoteUseCase(ai, vault, history, createMockConfig());
      await uc.execute(np('test.md'), true);

      expect(history.record).toHaveBeenCalledTimes(1);
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'classify' }),
      );
    });
  });
});
