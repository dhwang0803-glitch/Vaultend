import { NotePath } from '../values/NotePath';
import { NoteTitle } from '../values/NoteTitle';
import { HeadingPath } from '../values/HeadingPath';

/**
 * SaveTarget — 노트 저장 대상을 나타내는 봉인된 합 타입.
 * Android 아키텍처의 sealed class를 TypeScript discriminated union으로 대체한다.
 */
export type SaveTarget = NewNote | AppendToNote | DailyNote;

/** 새 노트를 생성하여 저장 */
export interface NewNote {
  readonly kind: 'new-note';
  readonly title: NoteTitle;
  readonly folder?: NotePath;
  readonly templatePath?: NotePath;
}

/** 기존 노트의 특정 위치에 내용을 추가 */
export interface AppendToNote {
  readonly kind: 'append-to-note';
  readonly targetPath: NotePath;
  readonly headingPath?: HeadingPath;
  readonly position: 'top' | 'bottom';
}

/** 오늘의 Daily Note에 내용을 추가 */
export interface DailyNote {
  readonly kind: 'daily-note';
  readonly headingPath?: HeadingPath;
  readonly position: 'top' | 'bottom';
}

/** SaveTarget 타입 가드 */
export function isNewNote(target: SaveTarget): target is NewNote {
  return target.kind === 'new-note';
}

export function isAppendToNote(target: SaveTarget): target is AppendToNote {
  return target.kind === 'append-to-note';
}

export function isDailyNote(target: SaveTarget): target is DailyNote {
  return target.kind === 'daily-note';
}
