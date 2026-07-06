import { TagName } from '../values/TagName';
import { NotePath } from '../values/NotePath';
import { Timestamp } from '../values/Timestamp';

/**
 * NoteMetadata — 노트의 YAML frontmatter와 파생 정보.
 */
export interface NoteMetadata {
  readonly tags: ReadonlyArray<TagName>;
  readonly aliases: ReadonlyArray<string>;
  readonly links: ReadonlyArray<NotePath>;
  readonly backlinks: ReadonlyArray<NotePath>;
  readonly createdAt: Timestamp;
  readonly modifiedAt: Timestamp;
  readonly isInbox: boolean;
  readonly isProcessed: boolean;
  readonly category?: string;
}
