import { App, TFile, CachedMetadata } from 'obsidian';
import { VaultAccessPort, VaultEventHandler } from '../../application/ports/VaultAccessPort';
import { Note, createNote } from '../../domain/models/Note';
import { NoteMetadata } from '../../domain/models/NoteMetadata';
import { NoteChunk } from '../../domain/models/NoteChunk';
import type { NoteMetadataEntry } from '../../domain/models/RefactorModels';
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
      await this.app.vault.process(existing, () => content);
    } else {
      const folderPath = pathStr.substring(0, pathStr.lastIndexOf('/'));
      if (folderPath) {
        await this.ensureFolderExists(folderPath);
      }
      try {
        await this.app.vault.create(pathStr, content);
      } catch {
        const file = this.app.vault.getAbstractFileByPath(pathStr);
        if (file instanceof TFile) {
          await this.app.vault.process(file, () => content);
        }
      }
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
      ? files.filter(f => f.path === folder || f.path.startsWith(folder + '/'))
      : files;

    return filtered.map(f => createNotePath(f.path));
  }

  async listFiles(folder: string, extension: string): Promise<ReadonlyArray<string>> {
    try {
      const exists = await this.app.vault.adapter.exists(folder);
      if (!exists) return [];
      const listing = await this.app.vault.adapter.list(folder);
      return listing.files.filter(f => f.endsWith('.' + extension));
    } catch {
      return [];
    }
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

  async moveNote(from: NotePath, to: NotePath): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(from as string);
    if (!(file instanceof TFile)) {
      throw new NoteNotFoundError(from as string);
    }
    const toStr = to as string;
    const folderPath = toStr.substring(0, toStr.lastIndexOf('/'));
    if (folderPath) {
      await this.ensureFolderExists(folderPath);
    }
    await this.app.fileManager.renameFile(file, toStr);
  }

  async listAllTags(): Promise<ReadonlyArray<{ tag: string; count: number }>> {
    const countByTag = new Map<string, number>();
    const files = this.app.vault.getMarkdownFiles();

    const trackTag = (tag: string, seen: Set<string>) => {
      const withHash = tag.startsWith('#') ? tag : `#${tag}`;
      if (seen.has(withHash)) return;
      seen.add(withHash);
      countByTag.set(withHash, (countByTag.get(withHash) ?? 0) + 1);
    };

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;

      const seen = new Set<string>();

      if (cache.tags) {
        for (const t of cache.tags) trackTag(t.tag, seen);
      }

      const fm = cache.frontmatter;
      if (fm && fm.tags != null) {
        const fmTags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
        for (const raw of fmTags) trackTag(String(raw), seen);
      }
    }

    return [...countByTag.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  async readFileRaw(path: string): Promise<string | null> {
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) return null;
      return await this.app.vault.adapter.read(path);
    } catch {
      return null;
    }
  }

  async writeFileRaw(path: string, content: string): Promise<void> {
    const folderPath = path.substring(0, path.lastIndexOf('/'));
    if (folderPath) {
      await this.ensureFolderExistsRaw(folderPath);
    }
    await this.app.vault.adapter.write(path, content);
  }

  private async ensureFolderExistsRaw(folderPath: string): Promise<void> {
    const parts = folderPath.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = await this.app.vault.adapter.exists(current);
      if (!exists) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  async getCanvasReferences(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const allFiles = this.app.vault.getFiles();
    const canvasFiles = allFiles.filter(f => f.extension === 'canvas');

    for (const canvas of canvasFiles) {
      try {
        const raw = await this.app.vault.read(canvas);
        const data = JSON.parse(raw) as { nodes?: Array<{ type?: string; file?: string }> };
        const refs: string[] = [];
        if (Array.isArray(data.nodes)) {
          for (const node of data.nodes) {
            if (node.type === 'file' && typeof node.file === 'string') {
              refs.push(node.file);
            }
          }
        }
        if (refs.length > 0) {
          result.set(canvas.path, refs);
        }
      } catch {
        // Ignore parse failures
      }
    }
    return result;
  }

  async listNotesWithMetadata(): Promise<ReadonlyArray<NoteMetadataEntry>> {
    const files = this.app.vault.getMarkdownFiles();
    const entries: NoteMetadataEntry[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
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
      const tags = [...new Set(rawTags)];

      const links: string[] = [];
      if (cache?.links) {
        for (const link of cache.links) {
          const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
          if (resolved) links.push(resolved.path);
        }
      }

      const backlinks: string[] = [];
      const resolvedLinks = this.app.metadataCache.resolvedLinks;
      for (const sourcePath of Object.keys(resolvedLinks)) {
        if (resolvedLinks[sourcePath]?.[file.path]) {
          backlinks.push(sourcePath);
        }
      }

      let wordCount: number;
      try {
        const content = await this.app.vault.cachedRead(file);
        const body = content.replace(/^(?:﻿)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
        const words = body.match(/\S+/g);
        wordCount = words ? words.length : 0;
      } catch {
        wordCount = Math.round(file.stat.size / 6);
      }

      const folder = file.path.includes('/')
        ? file.path.substring(0, file.path.lastIndexOf('/'))
        : '';

      entries.push({
        path: file.path,
        tags,
        links,
        backlinks,
        wordCount,
        createdAt: file.stat.ctime,
        modifiedAt: file.stat.mtime,
        folder,
        fileSize: file.stat.size,
      });
    }

    return entries;
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

    // Return unsubscribe function
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
      try {
        await this.app.vault.createFolder(folderPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Folder already exists')) throw err;
      }
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
          console.warn(`[Vaultend] Invalid tag detected, replaced with #untagged: "${t}"`);
          return createTagName('#untagged');
        }
      }),
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
      links,
      backlinks,
      frontmatterKeys: Object.keys(frontmatter).filter(k => k !== 'position'),
      fileSize: file.stat.size,
      createdAt: createTimestamp(file.stat.ctime),
      modifiedAt: createTimestamp(file.stat.mtime),
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
