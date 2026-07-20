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
      summary: 'A note about TypeScript',
      confidence: 0.9,
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
      tagDetails: [{ tag: '#typescript', score: 92, isNew: false, reason: 'TypeScript code' }],
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

    it('tagDetails가 있으면 tagReasons를 OrganizeResult에 포함한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote()),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification({
          suggestedTags: ['#typescript', '#react'],
          tagDetails: [
            { tag: '#typescript', score: 92, isNew: false, reason: 'TypeScript code' },
            { tag: '#react', score: 85, isNew: true, reason: 'React patterns' },
          ],
        })),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.tagReasons).toBeDefined();
      expect(result.tagReasons!.size).toBe(2);
      expect(result.tagReasons!.get('#typescript')).toEqual({
        score: 92, isNew: false, reason: 'TypeScript code',
      });
      expect(result.tagReasons!.get('#react')).toEqual({
        score: 85, isNew: true, reason: 'React patterns',
      });
    });

    it('tagDetails가 없으면 tagReasons는 undefined이다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote()),
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification({
          tagDetails: undefined,
        })),
      });

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      const result = await uc.execute(np('test.md'), false);

      expect(result.tagReasons).toBeUndefined();
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

    it('Related Notes 섹션을 추가한다 (임베딩 기반)', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: 'Content about React' }),
        ),
        listNotes: vi.fn().mockResolvedValue([np('test.md'), np('React.md')]),
      });
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue(makeClassification()),
      });

      const identicalVec = new Float32Array([1, 0, 0]);
      const cachedNoteEmbeddings = new Map<NotePath, Float32Array>([
        [np('test.md'), identicalVec],
        [np('React.md'), identicalVec],
      ]);

      const uc = new OrganizeNoteUseCase(ai, vault, createMockHistory(), createMockConfig());
      await uc.execute(np('test.md'), true, { cachedNoteEmbeddings });

      expect(vault.writeNote).toHaveBeenCalledWith(
        np('test.md'),
        expect.stringContaining('## Related Notes'),
      );
      expect(vault.writeNote).toHaveBeenCalledWith(
        np('test.md'),
        expect.stringContaining('[[React]]'),
      );
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
