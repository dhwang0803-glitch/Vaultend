import { describe, it, expect } from 'vitest';
import { createNoteTitle } from '../NoteTitle';

describe('createNoteTitle', () => {
  it('정상적인 제목을 생성한다', () => {
    expect(createNoteTitle('My Note') as string).toBe('My Note');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(createNoteTitle('  trimmed  ') as string).toBe('trimmed');
  });

  it('한국어 제목을 허용한다', () => {
    expect(createNoteTitle('테스트 노트') as string).toBe('테스트 노트');
  });

  it('빈 문자열은 거부한다', () => {
    expect(() => createNoteTitle('')).toThrow('빈 문자열');
  });

  it('공백만 있는 문자열은 거부한다', () => {
    expect(() => createNoteTitle('   ')).toThrow('빈 문자열');
  });

  it('255자 이하는 허용한다', () => {
    const title = 'a'.repeat(255);
    expect((createNoteTitle(title) as string).length).toBe(255);
  });

  it('256자 이상은 거부한다', () => {
    const title = 'a'.repeat(256);
    expect(() => createNoteTitle(title)).toThrow('255자');
  });
});
