import { NoteChunk } from '../../domain/models/NoteChunk';
import { SearchIndexPort, SearchResult } from '../ports/SearchIndexPort';

export class SearchNotesUseCase {
  constructor(
    private readonly searchIndex: SearchIndexPort,
  ) {}

  /**
   * 키워드 기반으로 노트 청크를 검색한다.
   */
  async execute(query: string, maxResults: number = 10): Promise<ReadonlyArray<SearchResult>> {
    if (!query.trim()) {
      return [];
    }
    return this.searchIndex.search(query, maxResults);
  }
}
