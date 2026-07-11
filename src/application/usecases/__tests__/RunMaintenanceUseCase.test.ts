import { describe, it, expect, vi } from 'vitest';
import { RunMaintenanceUseCase } from '../RunMaintenanceUseCase';
import { createMockVault, createMockSearch, createMockConfig, createMockClock } from '../../../test-utils/mock-ports';
import { createTestNote, createTestMetadata } from '../../../test-utils/fixtures';
import type { NotePath } from '../../../domain/values/NotePath';
import type { TagName } from '../../../domain/values/TagName';
import type { VaultAccessPort } from '../../ports/VaultAccessPort';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function tn(tag: string): TagName {
  return tag as unknown as TagName;
}

describe('RunMaintenanceUseCase', () => {
  let vault: VaultAccessPort;

  describe('findOrphanNotes (via execute)', () => {
    it('링크와 백링크가 모두 0개인 노트를 고아로 보고한다', async () => {
      const notes = [np('a.md'), np('b.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockImplementation(async (path: NotePath) => {
          if ((path as string) === 'a.md') {
            return createTestNote({
              path,
              metadata: createTestMetadata({ links: [], backlinks: [] }),
            });
          }
          return createTestNote({
            path,
            metadata: createTestMetadata({
              links: [np('a.md')],
              backlinks: [],
            }),
          });
        }),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.orphanNotes).toHaveLength(1);
      expect(plan.orphanNotes[0].notePath).toBe(np('a.md'));
      expect(plan.orphanNotes[0].fileSize).toBe(1024);
    });

    it('링크가 있으면 고아가 아니다', async () => {
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue([np('a.md')]),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            metadata: createTestMetadata({ links: [np('b.md')], backlinks: [] }),
          }),
        ),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.orphanNotes).toHaveLength(0);
    });
  });

  describe('findDuplicates (via execute)', () => {
    it('동일 제목 노트를 중복으로 감지한다 (Jaccard = 1.0)', async () => {
      const notes = [np('folder/my-note.md'), np('other/my-note.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata({ links: [np('x.md')] }) }),
        ),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.duplicateCandidates.length).toBeGreaterThanOrEqual(1);
      expect(plan.duplicateCandidates[0].similarityScore).toBe(1.0);
    });

    it('유사 제목을 Jaccard ≥ 0.6으로 감지한다', async () => {
      // "react hooks guide" vs "react hooks tutorial"
      // 토큰: [react, hooks, guide] vs [react, hooks, tutorial]
      // intersection = 2, union = 4 → Jaccard = 0.5 → 미검출
      // 더 유사한 예: "react hooks" vs "react hooks intro"
      // 토큰: [react, hooks] vs [react, hooks, intro]
      // intersection = 2, union = 3 → Jaccard ≈ 0.67
      const notes = [np('react-hooks.md'), np('react-hooks-intro.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata({ links: [np('x.md')] }) }),
        ),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.duplicateCandidates.length).toBeGreaterThanOrEqual(1);
      expect(plan.duplicateCandidates[0].similarityScore).toBeGreaterThanOrEqual(0.6);
    });

    it('완전히 다른 제목은 중복으로 감지하지 않는다', async () => {
      const notes = [np('typescript.md'), np('cooking-recipe.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata({ links: [np('x.md')] }) }),
        ),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.duplicateCandidates).toHaveLength(0);
    });

    it('같은 토큰을 공유하는 노트가 50개 초과이면 스킵한다', async () => {
      // 51개 노트가 동일 토큰을 공유 → paths.length > 50 → continue
      const notes = Array.from({ length: 51 }, (_, i) => np(`same-${i}.md`));
      // 모든 노트가 "same" 토큰만 가짐 → tokenIndex["same"].length = 51 > 50 → 스킵
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata({ links: [np('x.md')] }) }),
        ),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      // "same"만 토큰이므로 candidate가 0
      // 하지만 숫자 부분(0, 1, ...)은 개별 토큰으로 들어가서 일부 매칭될 수 있음
      // tokenize "same-0" → ["same", "0"]. "0" 토큰은 51개 모두에 없음 (각 숫자가 다름)
      // 실제로는 "same"만 >50이므로 스킵, 각 숫자 토큰은 1개씩이므로 후보 없음
      expect(plan.duplicateCandidates).toHaveLength(0);
    });
  });

  describe('findBrokenLinks (via execute)', () => {
    it('존재하지 않는 링크 대상을 깨진 링크로 보고한다', async () => {
      const notes = [np('source.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            path: np('source.md'),
            content: '# Note\n[[nonexistent]]을 참조합니다.',
            metadata: createTestMetadata({ links: [np('x.md')] }),
          }),
        ),
        exists: vi.fn().mockResolvedValue(false),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.brokenLinks).toHaveLength(1);
      expect(plan.brokenLinks[0].targetLink).toBe('nonexistent');
      expect(plan.brokenLinks[0].lineNumber).toBe(2);
    });

    it('basename으로 매칭되면 깨진 링크로 보고하지 않는다', async () => {
      const notes = [np('source.md'), np('folder/target.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockImplementation(async (path: NotePath) => {
          if ((path as string) === 'source.md') {
            return createTestNote({
              path,
              content: '[[target]] 참조',
              metadata: createTestMetadata({ links: [np('x.md')] }),
            });
          }
          return createTestNote({ path, metadata: createTestMetadata({ links: [np('x.md')] }) });
        }),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.brokenLinks).toHaveLength(0);
    });

    it('#heading 접미사가 유효하면 깨진 링크로 보고하지 않는다', async () => {
      const notes = [np('source.md'), np('target.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockImplementation(async (path: NotePath) => {
          if ((path as string) === 'source.md') {
            return createTestNote({
              path,
              content: '[[target#section]]를 참조',
              metadata: createTestMetadata({ links: [np('x.md')] }),
            });
          }
          return createTestNote({
            path,
            content: '# section\nSome content.',
            metadata: createTestMetadata({ links: [np('x.md')] }),
          });
        }),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.brokenLinks).toHaveLength(0);
    });

    it('alias가 있는 wikilink에서 대상 경로만 추출한다', async () => {
      const notes = [np('source.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            content: '[[missing|표시 텍스트]]',
            metadata: createTestMetadata({ links: [np('x.md')] }),
          }),
        ),
        exists: vi.fn().mockResolvedValue(false),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan.brokenLinks).toHaveLength(1);
      expect(plan.brokenLinks[0].targetLink).toBe('missing');
    });
  });

  describe('suggestMissingTags (via execute)', () => {
    it('콘텐츠에 known tag 키워드가 있으면 태그를 제안한다', async () => {
      const notes = [np('note.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            content: 'TypeScript는 좋은 언어다',
            metadata: createTestMetadata({ tags: [], links: [np('x.md')] }),
          }),
        ),
      });

      const config = createMockConfig({
        knownTags: [tn('#typescript')] as unknown as ReadonlyArray<TagName>,
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), config, createMockClock());
      const plan = await uc.execute();

      expect(plan.missingTags).toHaveLength(1);
      expect(plan.missingTags[0].suggestedTags.map(t => t as string)).toContain('#typescript');
    });

    it('이미 태그가 2개 이상인 노트는 건너뛴다', async () => {
      const notes = [np('note.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            content: 'TypeScript code here',
            metadata: createTestMetadata({
              tags: [tn('#dev'), tn('#code')] as unknown as ReadonlyArray<TagName>,
              links: [np('x.md')],
            }),
          }),
        ),
      });

      const config = createMockConfig({
        knownTags: [tn('#typescript')] as unknown as ReadonlyArray<TagName>,
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), config, createMockClock());
      const plan = await uc.execute();

      expect(plan.missingTags).toHaveLength(0);
    });

    it('4글자 미만 키워드는 매칭하지 않는다', async () => {
      const notes = [np('note.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            content: 'css is cool',
            metadata: createTestMetadata({ tags: [], links: [np('x.md')] }),
          }),
        ),
      });

      const config = createMockConfig({
        knownTags: [tn('#css')] as unknown as ReadonlyArray<TagName>,
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), config, createMockClock());
      const plan = await uc.execute();

      expect(plan.missingTags).toHaveLength(0);
    });

    it('knownTags가 비어있으면 빈 배열을 반환한다', async () => {
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue([np('note.md')]),
        readNote: vi.fn().mockResolvedValue(createTestNote()),
      });

      const config = createMockConfig({ knownTags: [] as unknown as ReadonlyArray<TagName> });
      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), config, createMockClock());
      const plan = await uc.execute();

      expect(plan.missingTags).toHaveLength(0);
    });

    it('이미 해당 태그를 가진 노트에는 다시 제안하지 않는다', async () => {
      const notes = [np('note.md')];
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue(notes),
        readNote: vi.fn().mockResolvedValue(
          createTestNote({
            content: 'TypeScript code',
            metadata: createTestMetadata({
              tags: [tn('#typescript')] as unknown as ReadonlyArray<TagName>,
              links: [np('x.md')],
            }),
          }),
        ),
      });

      const config = createMockConfig({
        knownTags: [tn('#typescript')] as unknown as ReadonlyArray<TagName>,
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), config, createMockClock());
      const plan = await uc.execute();

      expect(plan.missingTags).toHaveLength(0);
    });
  });

  describe('execute (통합)', () => {
    it('모든 분석 결과를 포함한 MaintenancePlan을 반환한다', async () => {
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue([]),
      });

      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), createMockClock());
      const plan = await uc.execute();

      expect(plan).toHaveProperty('orphanNotes');
      expect(plan).toHaveProperty('duplicateCandidates');
      expect(plan).toHaveProperty('brokenLinks');
      expect(plan).toHaveProperty('missingTags');
      expect(plan).toHaveProperty('timestamp');
    });

    it('timestamp에 clock.now() 값이 설정된다', async () => {
      vault = createMockVault({
        listNotes: vi.fn().mockResolvedValue([]),
      });
      const clock = createMockClock(1234567890000);
      const uc = new RunMaintenanceUseCase(vault, createMockSearch(), createMockConfig(), clock);
      const plan = await uc.execute();

      expect(plan.timestamp as number).toBe(1234567890000);
    });
  });
});
