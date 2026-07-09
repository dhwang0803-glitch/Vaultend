import { describe, it, expect } from 'vitest';
import { createNotePath, notePathToString } from '../NotePath';

describe('createNotePath', () => {
  it('.md 확장자 경로를 정상 생성한다', () => {
    const path = createNotePath('folder/note.md');
    expect(notePathToString(path)).toBe('folder/note.md');
  });

  it('중첩 폴더 경로를 정상 생성한다', () => {
    const path = createNotePath('a/b/c/deep.md');
    expect(notePathToString(path)).toBe('a/b/c/deep.md');
  });

  it('루트 경로를 정상 생성한다', () => {
    const path = createNotePath('root.md');
    expect(notePathToString(path)).toBe('root.md');
  });

  it('.md 확장자가 없으면 에러를 던진다', () => {
    expect(() => createNotePath('folder/note')).toThrow('.md');
  });

  it('.txt 확장자는 거부한다', () => {
    expect(() => createNotePath('note.txt')).toThrow('.md');
  });

  it('빈 문자열은 거부한다', () => {
    expect(() => createNotePath('')).toThrow('.md');
  });

  it('.md만 있는 경로도 허용한다', () => {
    const path = createNotePath('.md');
    expect(notePathToString(path)).toBe('.md');
  });
});

describe('notePathToString', () => {
  it('NotePath를 string으로 변환한다', () => {
    const path = createNotePath('test.md');
    expect(typeof notePathToString(path)).toBe('string');
    expect(notePathToString(path)).toBe('test.md');
  });
});
