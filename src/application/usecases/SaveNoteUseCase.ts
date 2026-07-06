import { SaveTarget } from '../../domain/models/SaveTarget';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { TagName } from '../../domain/values/TagName';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';

export interface SaveNoteRequest {
  readonly content: string;
  readonly target: SaveTarget;
  readonly tags?: ReadonlyArray<TagName>;
  readonly links?: ReadonlyArray<NotePath>;
}

export class SaveNoteUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * SaveTarget에 따라 노트를 저장한다.
   *
   * - NewNote: 새 마크다운 파일 생성
   * - AppendToNote: 기존 노트 끝(또는 특정 헤딩 아래)에 추가
   * - DailyNote: 오늘 Daily Note에 추가 (없으면 생성)
   */
  async execute(request: SaveNoteRequest): Promise<NotePath> {
    switch (request.target.kind) {
      case 'new-note':
        return this.createNewNote(request);
      case 'append-to-note':
        return this.appendToNote(request);
      case 'daily-note':
        return this.appendToDailyNote(request);
    }
  }

  private async createNewNote(request: SaveNoteRequest): Promise<NotePath> {
    const target = request.target as Extract<SaveTarget, { kind: 'new-note' }>;
    const frontmatter = this.buildFrontmatter(request.tags);
    const fullContent = `${frontmatter}\n${request.content}`;

    const folder = target.folder ?? await this.config.getSettings().then(s => s.defaultSaveFolder);
    const path = `${folder}/${target.title}.md` as NotePath;

    await this.vault.writeNote(path, fullContent);
    return path;
  }

  private async appendToNote(request: SaveNoteRequest): Promise<NotePath> {
    const target = request.target as Extract<SaveTarget, { kind: 'append-to-note' }>;
    const existingContent = await this.vault.readNote(target.targetPath);
    if (!existingContent) {
      throw new Error(`대상 노트를 찾을 수 없습니다: ${target.targetPath}`);
    }

    const newContent = target.headingPath
      ? this.insertUnderHeading(existingContent.content, target.headingPath, request.content, target.position)
      : this.appendToEnd(existingContent.content, request.content, target.position);

    await this.vault.writeNote(target.targetPath, newContent);
    return target.targetPath;
  }

  private async appendToDailyNote(request: SaveNoteRequest): Promise<NotePath> {
    const settings = await this.config.getSettings();
    const today = this.clock.now();
    const dailyNotePath = this.resolveDailyNotePath(settings.dailyNoteFormat, today);

    const existingNote = await this.vault.readNote(dailyNotePath);
    if (!existingNote) {
      // Daily Note 생성
      const template = settings.dailyNoteTemplate
        ? await this.vault.readNote(createNotePath(settings.dailyNoteTemplate))
        : null;
      const baseContent = template?.content ?? `# ${this.formatDate(today)}\n\n`;
      await this.vault.writeNote(dailyNotePath, baseContent + request.content);
    } else {
      const target = request.target as Extract<SaveTarget, { kind: 'daily-note' }>;
      const updated = target.headingPath
        ? this.insertUnderHeading(existingNote.content, target.headingPath, request.content, target.position)
        : this.appendToEnd(existingNote.content, request.content, target.position);
      await this.vault.writeNote(dailyNotePath, updated);
    }

    return dailyNotePath;
  }

  private buildFrontmatter(tags?: ReadonlyArray<TagName>): string {
    const lines = ['---'];
    if (tags && tags.length > 0) {
      lines.push(`tags: [${tags.join(', ')}]`);
    }
    lines.push(`created: ${new Date().toISOString()}`);
    lines.push('---');
    return lines.join('\n');
  }

  private insertUnderHeading(content: string, heading: any, text: string, position: string): string {
    throw new Error('구현 예정');
  }

  private appendToEnd(content: string, text: string, position: string): string {
    return position === 'top' ? `${text}\n\n${content}` : `${content}\n\n${text}`;
  }

  private resolveDailyNotePath(format: string, timestamp: any): NotePath {
    throw new Error('구현 예정');
  }

  private formatDate(timestamp: any): string {
    throw new Error('구현 예정');
  }
}
