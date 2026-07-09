import { describe, it, expect } from 'vitest';
import { createTagName } from '../TagName';

describe('createTagName', () => {
  it('#이 있는 태그를 그대로 생성한다', () => {
    expect(createTagName('#project') as string).toBe('#project');
  });

  it('#이 없으면 자동으로 추가한다', () => {
    expect(createTagName('project') as string).toBe('#project');
  });

  it('한국어 태그를 허용한다', () => {
    expect(createTagName('#프로젝트') as string).toBe('#프로젝트');
  });

  it('계층 태그(슬래시)를 허용한다', () => {
    expect(createTagName('#dev/frontend') as string).toBe('#dev/frontend');
  });

  it('하이픈을 허용한다', () => {
    expect(createTagName('#my-tag') as string).toBe('#my-tag');
  });

  it('언더스코어를 허용한다', () => {
    expect(createTagName('#my_tag') as string).toBe('#my_tag');
  });

  it('숫자를 허용한다', () => {
    expect(createTagName('#tag123') as string).toBe('#tag123');
  });

  it('공백이 포함된 태그는 거부한다', () => {
    expect(() => createTagName('#my tag')).toThrow('유효하지 않은 태그');
  });

  it('특수문자가 포함된 태그는 거부한다', () => {
    expect(() => createTagName('#tag@!')).toThrow('유효하지 않은 태그');
  });

  it('빈 문자열은 거부한다', () => {
    expect(() => createTagName('')).toThrow('유효하지 않은 태그');
  });

  it('#만 있으면 거부한다', () => {
    expect(() => createTagName('#')).toThrow('유효하지 않은 태그');
  });
});
