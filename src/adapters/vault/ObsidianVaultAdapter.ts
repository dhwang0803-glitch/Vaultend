import { App, TFile, CachedMetadata } from 'obsidian';
import { VaultAccessPort, VaultEventHandler } from '../../application/ports/VaultAccessPort';
import { Note, createNote } from '../../domain/models/Note';
import { NoteMetadata } from '../../domain/models/NoteMetadata';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createNoteId } from '../../domain/values/NoteId';
import { createNoteTitle } from '../../domain/values/NoteTitle';
import { createTimestamp } from '../../domain/values/Timestamp';
import { createTagName } from '../../domain/values/TagName';
import { createChunkText } from '../../domain/values/ChunkText';
import { createHeadingPath } from '../../domain/values/HeadingPath';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';

/**
 * Obsidian Vault API를 VaultAccessPort 인터페이스로 래핑한다.
 *
 * 이 어댑터는 Obsidian의 vault.read(), vault.modify(), vault.create()를
 * 도메인 모델로 변환하는 번역기 역할을 한다.
 */
export class ObsidianVaultAdapter implements VaultAccessPort {
  constructor(
    private readonly app: App,
  ) {}

  async readNote(path: NotePath): Promise<Note | null> {
    const file = this.app.vault.getAbstractFileByPath(path as string);
    if (!(file instanceof TFile)) return null;

    const content = await this.app.vault.read(file);
    const metadata = this.app.metadataCache.getFileCache(file);

    return createNote({
      id: createNoteId(file.path),
      path: createNotePath(file.path),
      title: createNoteTitle(file.basename),
      content,
      metadata: this.parseMetadata(file, metadata),
      chunks: this.splitIntoChunks(content),
    });
  }

  async writeNote(path: NotePath, content: string): Promise<void> {
    const pathStr = path as string;
    const existing = this.app.vault.getAbstractFileByPath(pathStr);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      // 부모 폴더가 없으면 생성
      const folderPath = pathStr.substring(0, pathStr.lastIndexOf('/'));
      if (folderPath) {
        await this.ensureFolderExists(folderPath);
      }
      await this.app.vault.create(pathStr, content);
    }
  }

  async deleteNote(path: NotePath): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path as string);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  async listNotes(folder?: string): Promise<ReadonlyArray<NotePath>> {
    const files = this.app.vault.getMarkdownFiles();
    const filtered = folder
      ? files.filter(f => f.path.startsWith(folder))
      : files;

    return filtered.map(f => createNotePath(f.path));
  }

  async updateFrontmatter(path: NotePath, updates: Record<string, unknown>): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path as string);
    if (!(file instanceof TFile)) {
      throw new NoteNotFoundError(path as string);
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, updates);
    });
  }

  async exists(path: NotePath): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(path as string) !== null;
  }

  watchEvents(handler: VaultEventHandler): () => void {
    const createRef = this.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        handler({ type: 'create', path: createNotePath(file.path) });
      }
    });

    const modifyRef = this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        handler({ type: 'modify', path: createNotePath(file.path) });
      }
    });

    const deleteRef = this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        handler({ type: 'delete', path: createNotePath(file.path) });
      }
    });

    const renameRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'md') {
        handler({
          type: 'rename',
          path: createNotePath(file.path),
          oldPath: createNotePath(oldPath),
        });
      }
    });

    // 해제 함수 반환
    return () => {
      this.app.vault.offref(createRef);
      this.app.vault.offref(modifyRef);
      this.app.vault.offref(deleteRef);
      this.app.vault.offref(renameRef);
    };
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (!existing) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  private parseMetadata(file: TFile, cache: CachedMetadata | null): NoteMetadata {
    const frontmatter = cache?.frontmatter ?? {};
    const rawTags: string[] = [];

    if (cache?.tags) {
      for (const t of cache.tags) rawTags.push(t.tag);
    }
    if (Array.isArray(frontmatter.tags)) {
      for (const t of frontmatter.tags) {
        const tag = String(t);
        rawTags.push(tag.startsWith('#') ? tag : `#${tag}`);
      }
    }

    const uniqueTags = [...new Set(rawTags)];

    const links: NotePath[] = [];
    if (cache?.links) {
      for (const link of cache.links) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (resolved) links.push(createNotePath(resolved.path));
      }
    }

    const backlinks: NotePath[] = [];
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const sourcePath of Object.keys(resolvedLinks)) {
      if (resolvedLinks[sourcePath]?.[file.path]) {
        backlinks.push(createNotePath(sourcePath));
      }
    }

    return {
      tags: uniqueTags.map(t => {
        try { return createTagName(t); }
        catch {
          console.warn(`[Knowledge Maintenance] 비정상 태그 감지, #untagged로 대체: "${t}"`);
          return createTagName('#untagged');
        }
      }),
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
      links,
      backlinks,
      frontmatterKeys: Object.keys(frontmatter).filter(k => k !== 'position'),
      createdAt: createTimestamp(file.stat.ctime),
      modifiedAt: createTimestamp(file.stat.mtime),
      isInbox: false,
      isProcessed: frontmatter['processed'] === true,
      category: frontmatter.category as string | undefined,
    };
  }

  private splitIntoChunks(content: string): NoteChunk[] {
    const lines = content.split('\n');
    const chunks: NoteChunk[] = [];
    let currentHeading = '';
    let currentLines: string[] = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        if (currentLines.length > 0) {
          chunks.push({
            headingPath: createHeadingPath(currentHeading || '(root)'),
            text: createChunkText(currentLines.join('\n').trim()),
            startLine,
            endLine: i - 1,
          });
        }
        currentHeading = match[2].trim();
        currentLines = [lines[i]];
        startLine = i;
      } else {
        currentLines.push(lines[i]);
      }
    }

    if (currentLines.length > 0) {
      const text = currentLines.join('\n').trim();
      if (text) {
        chunks.push({
          headingPath: createHeadingPath(currentHeading || '(root)'),
          text: createChunkText(text),
          startLine,
          endLine: lines.length - 1,
        });
      }
    }

    return chunks;
  }
}
