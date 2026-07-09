import { describe, it, expect } from 'vitest';
import { createNoteId, noteIdToString } from '../NoteId';

describe('createNoteId', () => {
  it('정상적인 ID를 생성한다', () => {
    const id = createNoteId('abc-123');
    expect(noteIdToString(id)).toBe('abc-123');
  });

  it('UUID 형식을 허용한다', () => {
    const id = createNoteId('550e8400-e29b-41d4-a716-446655440000');
    expect(noteIdToString(id)).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('빈 문자열은 거부한다', () => {
    expect(() => createNoteId('')).toThrow('빈 문자열');
  });

  it('공백만 있는 문자열은 거부한다', () => {
    expect(() => createNoteId('   ')).toThrow('빈 문자열');
  });
});

describe('noteIdToString', () => {
  it('NoteId를 string으로 변환한다', () => {
    const id = createNoteId('test-id');
    expect(typeof noteIdToString(id)).toBe('string');
  });
});
