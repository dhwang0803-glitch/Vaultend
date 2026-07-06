import { OrganizeNoteUseCase } from './OrganizeNoteUseCase';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ConfigPort } from '../ports/ConfigPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { NotePath } from '../../domain/values/NotePath';

export interface InboxProcessResult {
  readonly processedCount: number;
  readonly skippedCount: number;
  readonly results: ReadonlyArray<OrganizeResult>;
  readonly errors: ReadonlyArray<{ path: NotePath; error: string }>;
}

export class RunInboxProcessUseCase {
  constructor(
    private readonly organizeNote: OrganizeNoteUseCase,
    private readonly vault: VaultAccessPort,
    private readonly config: ConfigPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Inbox 폴더의 미처리 노트를 일괄 정리한다.
   *
   * 1. Inbox 폴더 내 모든 노트 목록 조회
   * 2. 이미 처리된 노트(frontmatter에 processed: true) 필터링
   * 3. 각 미처리 노트에 대해 OrganizeNoteUseCase 실행
   * 4. 처리 결과 집계 및 반환
   */
  async execute(): Promise<InboxProcessResult> {
    const settings = await this.config.getSettings();
    const inboxFolder = settings.inboxFolder;

    const inboxNotes = await this.vault.listNotes(inboxFolder);
    const unprocessedNotes = [];

    for (const notePath of inboxNotes) {
      const note = await this.vault.readNote(notePath);
      if (note && !note.metadata.isProcessed) {
        unprocessedNotes.push(notePath);
      }
    }

    const results: OrganizeResult[] = [];
    const errors: Array<{ path: NotePath; error: string }> = [];

    for (const notePath of unprocessedNotes) {
      try {
        const result = await this.organizeNote.execute(
          notePath,
          settings.autoApplyInbox,
        );
        results.push(result);

        // 처리 완료 마킹
        await this.vault.updateFrontmatter(notePath, { processed: true });
      } catch (err) {
        errors.push({
          path: notePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      processedCount: results.length,
      skippedCount: inboxNotes.length - unprocessedNotes.length,
      results,
      errors,
    };
  }
}
