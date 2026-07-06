/** 노트 제목 — 파일명에서 확장자를 제외한 부분 */
export type NoteTitle = string & { readonly __brand: unique symbol };

export function createNoteTitle(raw: string): NoteTitle {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('NoteTitle은 빈 문자열일 수 없습니다');
  }
  if (trimmed.length > 255) {
    throw new Error('NoteTitle은 255자를 초과할 수 없습니다');
  }
  return trimmed as NoteTitle;
}
