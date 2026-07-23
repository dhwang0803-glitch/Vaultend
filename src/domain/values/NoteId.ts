/** 노트 고유 식별자 — Vault 내에서 노트를 유일하게 구분한다 */
export type NoteId = string & { readonly __brand: unique symbol };

export function createNoteId(raw: string): NoteId {
  if (!raw || raw.trim().length === 0) {
    throw new Error('NoteId는 빈 문자열일 수 없습니다');
  }
  return raw as NoteId;
}

export function noteIdToString(id: NoteId): string {
  return id;
}
