import { NoteId } from '../values/NoteId';
import { NotePath } from '../values/NotePath';
import { NoteTitle } from '../values/NoteTitle';
import { NoteMetadata } from './NoteMetadata';
import { NoteChunk } from './NoteChunk';

/**
 * Note 엔티티 — Vault 내 하나의 마크다운 파일을 나타낸다.
 * 불변(Immutable) 객체로 설계한다.
 */
export interface Note {
  readonly id: NoteId;
  readonly path: NotePath;
  readonly title: NoteTitle;
  readonly content: string;
  readonly metadata: NoteMetadata;
  readonly chunks: ReadonlyArray<NoteChunk>;
}

/** Note 생성 팩토리 함수 */
export function createNote(params: {
  id: NoteId;
  path: NotePath;
  title: NoteTitle;
  content: string;
  metadata: NoteMetadata;
  chunks: NoteChunk[];
}): Note {
  return Object.freeze({ ...params, chunks: Object.freeze([...params.chunks]) });
}
