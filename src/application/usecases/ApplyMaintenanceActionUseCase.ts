import { MaintenanceAction } from '../../domain/models/MaintenanceAction';
import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { TagName } from '../../domain/values/TagName';

export interface ApplyResult {
  readonly entryId: string;
  readonly undoable: boolean;
}

export class ApplyMaintenanceActionUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(action: MaintenanceAction): Promise<ApplyResult | null> {
    switch (action.kind) {
      case 'delete-orphan':
        return this.deleteOrphan(action.notePath);
      case 'remove-broken-link':
        return this.removeBrokenLink(action.sourcePath, action.targetLink, action.lineNumber);
      case 'create-missing-note':
        return this.createMissingNote(action.targetLink);
      case 'apply-missing-tags':
        return this.applyMissingTags(action.notePath, action.tags);
      case 'archive-note':
        return this.archiveNote(action.notePath, action.targetFolder);
      case 'dismiss':
        return this.dismiss(action.issueType, action.identifier);
    }
  }

  private async deleteOrphan(notePath: NotePath): Promise<ApplyResult | null> {
    const note = await this.vault.readNote(notePath);
    if (!note) return null;

    await this.vault.deleteNote(notePath);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'delete',
      notePath,
      timestamp: this.clock.now(),
      description: `고아 노트 삭제: ${notePath as string}`,
      previousContent: note.content,
    };
    await this.history.record(entry);
    return { entryId: entry.id, undoable: true };
  }

  private async removeBrokenLink(sourcePath: NotePath, targetLink: string, lineNumber: number): Promise<ApplyResult | null> {
    const note = await this.vault.readNote(sourcePath);
    if (!note) return null;

    const lines = note.content.split('\n');
    const targetLineIdx = lineNumber - 1;
    if (targetLineIdx < 0 || targetLineIdx >= lines.length) return null;

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
    return { entryId: entry.id, undoable: true };
  }

  private async createMissingNote(targetLink: string): Promise<ApplyResult | null> {
    const hashIdx = targetLink.indexOf('#');
    const baseName = hashIdx !== -1 ? targetLink.substring(0, hashIdx) : targetLink;
    if (!baseName) return null;

    const normalized = baseName.endsWith('.md') ? baseName : `${baseName}.md`;
    const notePath = createNotePath(normalized);

    const content = `# ${baseName}\n`;
    await this.vault.writeNote(notePath, content);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'create',
      notePath,
      timestamp: this.clock.now(),
      description: `누락 노트 생성: ${baseName}`,
    };
    await this.history.record(entry);
    return { entryId: entry.id, undoable: false };
  }

  private async applyMissingTags(notePath: NotePath, tags: ReadonlyArray<TagName>): Promise<ApplyResult | null> {
    const note = await this.vault.readNote(notePath);
    if (!note) return null;

    const frontmatterTags = this.extractFrontmatterTags(note.content);
    const allExisting = note.metadata.tags.map(t => t as string);
    const newTags = tags.filter(t => !allExisting.includes(t as string));
    if (newTags.length === 0) return null;

    const updatedFmTags = [...frontmatterTags, ...newTags.map(t => t as string)];
    await this.vault.updateFrontmatter(notePath, { tags: updatedFmTags });

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'tag-add',
      notePath,
      timestamp: this.clock.now(),
      description: `태그 추가: ${newTags.join(', ')} → ${notePath as string}`,
      previousContent: note.content,
    };
    await this.history.record(entry);
    return { entryId: entry.id, undoable: true };
  }

  private async archiveNote(notePath: NotePath, targetFolder: string): Promise<ApplyResult> {
    const basename = (notePath as string).split('/').pop() ?? '';
    const destPath = createNotePath(`${targetFolder}/${basename}`);
    await this.vault.moveNote(notePath, destPath);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'archive',
      notePath,
      timestamp: this.clock.now(),
      description: `노트 아카이브: ${notePath as string} → ${targetFolder}/`,
      metadata: { archivedTo: destPath as string },
    };
    await this.history.record(entry);
    return { entryId: entry.id, undoable: true };
  }

  private async dismiss(issueType: string, identifier: string): Promise<ApplyResult> {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'dismiss',
      notePath: createNotePath(`${identifier}.md`.replace(/\.md\.md$/, '.md')),
      timestamp: this.clock.now(),
      description: `이슈 무시: [${issueType}] ${identifier}`,
    };
    await this.history.record(entry);
    return { entryId: entry.id, undoable: false };
  }

  private extractFrontmatterTags(content: string): string[] {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return [];
    const fmBlock = fmMatch[1];
    const tagsMatch = fmBlock.match(/^tags:\s*\[([^\]]*)\]/m)
      ?? fmBlock.match(/^tags:\s*\n((?:\s*-\s*.+\n?)*)/m);
    if (!tagsMatch) return [];

    if (tagsMatch[0].includes('[')) {
      return tagsMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        .map(t => t.startsWith('#') ? t : `#${t}`);
    }
    return tagsMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
      .map(t => t.startsWith('#') ? t : `#${t}`);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
