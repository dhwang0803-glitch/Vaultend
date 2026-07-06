import { NoteChunk } from '../../domain/models/NoteChunk';
import { NotePath } from '../../domain/values/NotePath';

/**
 * 검색 인덱스 포트 — 노트 청크의 인덱싱과 검색을 추상화한다.
 */
export interface SearchIndexPort {
  /** 노트의 청크들을 인덱스에 추가 또는 갱신. */
  index(notePath: NotePath, chunks: ReadonlyArray<NoteChunk>): Promise<void>;

  /** 키워드 기반 검색. 관련도 순으로 정렬된 결과 반환. */
  search(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>>;

  /** 특정 노트의 인덱스 항목 제거. */
  remove(notePath: NotePath): Promise<void>;

  /** 전체 인덱스 재구축. */
  rebuild(): Promise<void>;
}

export interface SearchResult {
  readonly notePath: NotePath;
  readonly chunk: NoteChunk;
  readonly score: number;
}
