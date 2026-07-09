import { SaveTarget } from '../../domain/models/SaveTarget';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { TagName } from '../../domain/values/TagName';
import { HeadingPath } from '../../domain/values/HeadingPath';
import { Timestamp } from '../../domain/values/Timestamp';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';
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
      throw new NoteNotFoundError(target.targetPath as string);
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
    const dailyNotePath = this.resolveDailyNotePath(settings.dailyNoteFormat, settings.dailyNoteFolder, today);

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

  private insertUnderHeading(content: string, heading: HeadingPath, text: string, position: 'top' | 'bottom'): string {
    const headingStr = heading as string;
    const lines = content.split('\n');
    const headingPattern = new RegExp(`^#{1,6}\\s+${headingStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

    let headingLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (headingPattern.test(lines[i])) {
        headingLineIdx = i;
        break;
      }
    }

    if (headingLineIdx === -1) {
      return `${content}\n\n## ${headingStr}\n\n${text}`;
    }

    const headingLevel = (lines[headingLineIdx].match(/^(#+)/) ?? ['', '#'])[1].length;
    let sectionEnd = lines.length;
    for (let i = headingLineIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s/);
      if (m && m[1].length <= headingLevel) {
        sectionEnd = i;
        break;
      }
    }

    if (position === 'top') {
      lines.splice(headingLineIdx + 1, 0, '', text);
    } else {
      lines.splice(sectionEnd, 0, '', text);
    }

    return lines.join('\n');
  }

  private appendToEnd(content: string, text: string, position: 'top' | 'bottom'): string {
    return position === 'top' ? `${text}\n\n${content}` : `${content}\n\n${text}`;
  }

  private resolveDailyNotePath(format: string, folder: string, timestamp: Timestamp): NotePath {
    const dateStr = this.formatDate(timestamp, format);
    const prefix = folder ? `${folder}/` : '';
    return createNotePath(`${prefix}${dateStr}.md`);
  }

  private formatDate(timestamp: Timestamp, format?: string): string {
    const date = new Date(timestamp as number);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    const pattern = format ?? 'YYYY-MM-DD';
    return pattern
      .replace('YYYY', String(y))
      .replace('MM', m)
      .replace('DD', d);
  }
}
