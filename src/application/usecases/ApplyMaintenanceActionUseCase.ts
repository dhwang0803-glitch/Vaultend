import { MaintenanceAction } from '../../domain/models/MaintenanceAction';
import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { TagName } from '../../domain/values/TagName';

export class ApplyMaintenanceActionUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(action: MaintenanceAction): Promise<void> {
    switch (action.kind) {
      case 'delete-orphan':
        return this.deleteOrphan(action.notePath);
      case 'remove-broken-link':
        return this.removeBrokenLink(action.sourcePath, action.targetLink, action.lineNumber);
      case 'create-missing-note':
        return this.createMissingNote(action.targetLink);
      case 'apply-missing-tags':
        return this.applyMissingTags(action.notePath, action.tags);
      case 'dismiss':
        return this.dismiss(action.issueType, action.identifier);
    }
  }

  private async deleteOrphan(notePath: NotePath): Promise<void> {
    const note = await this.vault.readNote(notePath);
    const previousContent = note?.content ?? '';

    await this.vault.deleteNote(notePath);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'delete',
      notePath,
      timestamp: this.clock.now(),
      description: `고아 노트 삭제: ${notePath as string}`,
      previousContent,
    };
    await this.history.record(entry);
  }

  private async removeBrokenLink(sourcePath: NotePath, targetLink: string, lineNumber: number): Promise<void> {
    const note = await this.vault.readNote(sourcePath);
    if (!note) return;

    const lines = note.content.split('\n');
    const targetLineIdx = lineNumber - 1;
    if (targetLineIdx < 0 || targetLineIdx >= lines.length) return;

    const wikiLinkPattern = new RegExp(`\\[\\[${this.escapeRegex(targetLink)}(\\|[^\\]]+)?\\]\\]`, 'g');
    lines[targetLineIdx] = lines[targetLineIdx].replace(wikiLinkPattern, targetLink);

    const newContent = lines.join('\n');
    await this.vault.writeNote(sourcePath, newContent);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'link-remove',
      notePath: sourcePath,
      timestamp: this.clock.now(),
      description: `깨진 링크 제거: [[${targetLink}]] → ${targetLink} (${sourcePath as string}:${lineNumber})`,
      previousContent: note.content,
    };
    await this.history.record(entry);
  }

  private async createMissingNote(targetLink: string): Promise<void> {
    const normalized = targetLink.endsWith('.md') ? targetLink : `${targetLink}.md`;
    const notePath = createNotePath(normalized);

    const content = `# ${targetLink}\n`;
    await this.vault.writeNote(notePath, content);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'create',
      notePath,
      timestamp: this.clock.now(),
      description: `누락 노트 생성: ${targetLink}`,
    };
    await this.history.record(entry);
  }

  private async applyMissingTags(notePath: NotePath, tags: ReadonlyArray<TagName>): Promise<void> {
    const note = await this.vault.readNote(notePath);
    if (!note) return;

    const existingTags = note.metadata.tags.map(t => t as string);
    const newTags = tags.filter(t => !existingTags.includes(t as string));
    if (newTags.length === 0) return;

    const allTags = [...existingTags, ...newTags.map(t => t as string)];
    await this.vault.updateFrontmatter(notePath, { tags: allTags });

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'tag-add',
      notePath,
      timestamp: this.clock.now(),
      description: `태그 추가: ${newTags.join(', ')} → ${notePath as string}`,
      previousContent: note.content,
    };
    await this.history.record(entry);
  }

  private async dismiss(issueType: string, identifier: string): Promise<void> {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'dismiss',
      notePath: createNotePath(`${identifier}.md`.replace(/\.md\.md$/, '.md')),
      timestamp: this.clock.now(),
      description: `이슈 무시: [${issueType}] ${identifier}`,
    };
    await this.history.record(entry);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
