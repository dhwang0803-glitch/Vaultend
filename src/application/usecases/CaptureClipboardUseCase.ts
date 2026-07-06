import { ClipboardPort } from '../ports/ClipboardPort';
import { SaveNoteUseCase, SaveNoteRequest } from './SaveNoteUseCase';
import { ConfigPort } from '../ports/ConfigPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath } from '../../domain/values/NotePath';
import { createNoteTitle } from '../../domain/values/NoteTitle';
import { createNotePath } from '../../domain/values/NotePath';

export class CaptureClipboardUseCase {
  constructor(
    private readonly clipboard: ClipboardPort,
    private readonly saveNote: SaveNoteUseCase,
    private readonly config: ConfigPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * 클립보드 내용을 읽어 Inbox에 새 노트로 저장한다.
   *
   * 1. 클립보드 텍스트 읽기
   * 2. 비어 있으면 에러
   * 3. 제목 생성 (타임스탬프 기반)
   * 4. Inbox 폴더에 새 노트 생성
   * 5. 이력 기록
   */
  async execute(): Promise<NotePath> {
    const clipboardText = await this.clipboard.read();

    if (!clipboardText || clipboardText.trim().length === 0) {
      throw new Error('클립보드가 비어 있습니다');
    }

    const settings = await this.config.getSettings();
    const now = this.clock.now();
    const title = createNoteTitle(`클립보드 캡처 ${new Date(now).toISOString().replace(/[:.]/g, '-')}`);

    const savedPath = await this.saveNote.execute({
      content: clipboardText,
      target: {
        kind: 'new-note',
        title,
        folder: createNotePath(`${settings.inboxFolder}/placeholder.md`), // 폴더 용도
      },
    });

    await this.history.record({
      id: crypto.randomUUID(),
      action: 'clipboard-capture',
      notePath: savedPath,
      timestamp: now,
      description: `클립보드 캡처: ${clipboardText.substring(0, 50)}...`,
    });

    return savedPath;
  }
}
