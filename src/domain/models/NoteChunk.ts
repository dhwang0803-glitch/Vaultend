import { ChunkText } from '../values/ChunkText';
import { HeadingPath } from '../values/HeadingPath';

/**
 * NoteChunk — 노트를 헤딩 기준으로 분할한 섹션 단위.
 * 검색 인덱싱과 AI 컨텍스트 구성에 사용된다.
 */
export interface NoteChunk {
  readonly headingPath: HeadingPath;
  readonly text: ChunkText;
  readonly startLine: number;
  readonly endLine: number;
}
