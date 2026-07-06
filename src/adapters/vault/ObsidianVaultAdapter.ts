import { App, TFile, TFolder, Vault, MetadataCache } from 'obsidian';
import { VaultAccessPort, VaultEvent, VaultEventHandler } from '../../application/ports/VaultAccessPort';
import { Note, createNote } from '../../domain/models/Note';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createNoteId } from '../../domain/values/NoteId';
import { createNoteTitle } from '../../domain/values/NoteTitle';
import { createTimestamp } from '../../domain/values/Timestamp';

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
      throw new Error(`노트를 찾을 수 없습니다: ${path}`);
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

  private parseMetadata(file: TFile, cache: any): any {
    // MetadataCache에서 태그, 링크, 프론트매터 파싱
    throw new Error('구현 예정');
  }

  private splitIntoChunks(content: string): any[] {
    // 헤딩 기준으로 노트를 청크로 분할
    throw new Error('구현 예정');
  }
}
