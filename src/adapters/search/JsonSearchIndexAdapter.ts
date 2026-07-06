import { SearchIndexPort, SearchResult } from '../../application/ports/SearchIndexPort';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { NotePath } from '../../domain/values/NotePath';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';

/**
 * JSON 기반 검색 인덱스 어댑터.
 *
 * 외부 검색 엔진 없이 Vault 내 JSON 파일로 인덱스를 유지한다.
 * 소규모~중규모 Vault(~5,000 노트)에서 충분한 성능을 제공한다.
 *
 * 인덱스 파일 위치: .knowledge-maintenance/search-index.json
 */
export class JsonSearchIndexAdapter implements SearchIndexPort {
  private static readonly INDEX_PATH = '.knowledge-maintenance/search-index.json';
  private indexCache: Map<string, IndexEntry[]> = new Map();
  private dirty = false;

  constructor(
    private readonly vault: VaultAccessPort,
  ) {}

  async index(notePath: NotePath, chunks: ReadonlyArray<NoteChunk>): Promise<void> {
    const entries: IndexEntry[] = chunks.map(chunk => ({
      notePath: notePath as string,
      headingPath: chunk.headingPath as string,
      text: (chunk.text as string).toLowerCase(),
      originalText: chunk.text as string,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    }));

    this.indexCache.set(notePath as string, entries);
    this.dirty = true;
    await this.flush();
  }

  async search(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>> {
    await this.ensureLoaded();

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const results: Array<SearchResult & { _score: number }> = [];

    for (const [, entries] of this.indexCache) {
      for (const entry of entries) {
        const score = this.calculateScore(entry.text, queryTerms);
        if (score > 0) {
          results.push({
            notePath: entry.notePath as NotePath,
            chunk: {
              headingPath: entry.headingPath,
              text: entry.originalText,
              startLine: entry.startLine,
              endLine: entry.endLine,
            } as NoteChunk,
            score,
            _score: score,
          });
        }
      }
    }

    results.sort((a, b) => b._score - a._score);
    return results.slice(0, maxResults);
  }

  async remove(notePath: NotePath): Promise<void> {
    this.indexCache.delete(notePath as string);
    this.dirty = true;
    await this.flush();
  }

  async rebuild(): Promise<void> {
    this.indexCache.clear();
    this.dirty = true;
    // 전체 Vault를 다시 인덱싱해야 함 — 호출자가 처리
  }

  private calculateScore(text: string, queryTerms: string[]): number {
    let score = 0;
    for (const term of queryTerms) {
      const index = text.indexOf(term);
      if (index !== -1) {
        score += 1;
        // 완전 일치 보너스
        if (text.includes(` ${term} `)) score += 0.5;
      }
    }
    return score;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.indexCache.size > 0) return;

    const indexPath = JsonSearchIndexAdapter.INDEX_PATH as NotePath;
    const note = await this.vault.readNote(indexPath);
    if (note) {
      const data: Record<string, IndexEntry[]> = JSON.parse(note.content);
      for (const [key, entries] of Object.entries(data)) {
        this.indexCache.set(key, entries);
      }
    }
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return;

    const data: Record<string, IndexEntry[]> = {};
    for (const [key, entries] of this.indexCache) {
      data[key] = entries;
    }

    const indexPath = JsonSearchIndexAdapter.INDEX_PATH as NotePath;
    await this.vault.writeNote(indexPath, JSON.stringify(data, null, 2));
    this.dirty = false;
  }
}

interface IndexEntry {
  notePath: string;
  headingPath: string;
  text: string;       // 검색용 소문자
  originalText: string; // 원본 텍스트
  startLine: number;
  endLine: number;
}
