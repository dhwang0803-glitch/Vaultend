import MiniSearch from 'minisearch';
import { SearchIndexPort, SearchResult } from '../../application/ports/SearchIndexPort';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { NotePath } from '../../domain/values/NotePath';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { HeadingPath } from '../../domain/values/HeadingPath';
import { ChunkText } from '../../domain/values/ChunkText';
import { SEARCH_INDEX_PATH } from '../../constants';

interface IndexedDocument {
  id: string;
  notePath: string;
  noteName: string;
  headingPath: string;
  text: string;
  originalText: string;
  startLine: number;
  endLine: number;
}

const INDEX_VERSION = 2;

const MINISEARCH_OPTIONS = {
  fields: ['text', 'noteName'],
  storeFields: ['notePath', 'headingPath', 'originalText', 'startLine', 'endLine'],
  idField: 'id',
};

export class JsonSearchIndexAdapter implements SearchIndexPort {
  private miniSearch: MiniSearch<IndexedDocument>;
  private noteDocIds: Map<string, string[]> = new Map();
  private dirty = false;
  private loaded = false;

  constructor(private readonly vault: VaultAccessPort) {
    this.miniSearch = this.createMiniSearch();
  }

  private createMiniSearch(): MiniSearch<IndexedDocument> {
    return new MiniSearch<IndexedDocument>({
      ...MINISEARCH_OPTIONS,
      autoVacuum: false,
      searchOptions: {
        prefix: true,
        fuzzy: false,
        boost: { noteName: 3 },
      },
    });
  }

  async index(notePath: NotePath, chunks: ReadonlyArray<NoteChunk>): Promise<void> {
    await this.ensureLoaded();

    const pathStr = notePath as string;
    const noteName = pathStr.split('/').pop()?.replace(/\.md$/, '') ?? pathStr;

    const existingIds = this.noteDocIds.get(pathStr) ?? [];
    if (existingIds.length > 0) {
      this.miniSearch.discardAll(existingIds);
    }

    const newIds: string[] = [];
    for (const chunk of chunks) {
      const id = `${pathStr}::${chunk.startLine}`;
      newIds.push(id);
      this.miniSearch.add({
        id,
        notePath: pathStr,
        noteName,
        headingPath: chunk.headingPath as string,
        text: chunk.text as string,
        originalText: chunk.text as string,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }

    this.noteDocIds.set(pathStr, newIds);
    this.dirty = true;
    await this.flush();
  }

  async search(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>> {
    await this.ensureLoaded();

    if (!query.trim()) return [];

    const results = this.miniSearch.search(query, { prefix: true, boost: { noteName: 3 } });

    const MAX_PER_NOTE = 3;
    const noteCounts = new Map<string, number>();
    const diverse: typeof results = [];
    for (const r of results) {
      const count = noteCounts.get(r.notePath as string) ?? 0;
      if (count >= MAX_PER_NOTE) continue;
      noteCounts.set(r.notePath as string, count + 1);
      diverse.push(r);
      if (diverse.length >= maxResults) break;
    }

    return diverse.map(result => ({
      notePath: result.notePath as NotePath,
      chunk: {
        headingPath: result.headingPath as unknown as HeadingPath,
        text: result.originalText as unknown as ChunkText,
        startLine: result.startLine as number,
        endLine: result.endLine as number,
      } as NoteChunk,
      score: result.score,
    }));
  }

  async remove(notePath: NotePath): Promise<void> {
    await this.ensureLoaded();

    const ids = this.noteDocIds.get(notePath as string) ?? [];
    if (ids.length > 0) {
      this.miniSearch.discardAll(ids);
    }
    this.noteDocIds.delete(notePath as string);
    this.dirty = true;
    await this.flush();
  }

  async rebuild(): Promise<void> {
    this.miniSearch = this.createMiniSearch();
    this.noteDocIds.clear();
    this.dirty = true;
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const raw = await this.vault.readFileRaw(SEARCH_INDEX_PATH);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.miniSearchIndex && data.noteDocIds && data.version === INDEX_VERSION) {
          this.miniSearch = MiniSearch.loadJSON<IndexedDocument>(
            JSON.stringify(data.miniSearchIndex),
            { ...MINISEARCH_OPTIONS, autoVacuum: false, searchOptions: { prefix: true, fuzzy: false, boost: { noteName: 3 } } },
          );
          this.noteDocIds = new Map(Object.entries(data.noteDocIds as Record<string, string[]>));
        } else {
          this.dirty = true;
          await this.flush();
        }
      } catch {
        // Corrupted index — start fresh
      }
    }
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return;

    const serialized = {
      version: INDEX_VERSION,
      miniSearchIndex: this.miniSearch.toJSON(),
      noteDocIds: Object.fromEntries(this.noteDocIds),
    };

    await this.vault.writeFileRaw(
      SEARCH_INDEX_PATH,
      JSON.stringify(serialized),
    );
    this.dirty = false;
  }
}
