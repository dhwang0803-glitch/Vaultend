import { NotePath } from '../values/NotePath';
import { TagName } from '../values/TagName';

export type MaintenanceAction =
  | DeleteOrphan
  | RemoveBrokenLink
  | CreateMissingNote
  | ApplyMissingTags
  | DismissIssue;

export interface DeleteOrphan {
  readonly kind: 'delete-orphan';
  readonly notePath: NotePath;
}

export interface RemoveBrokenLink {
  readonly kind: 'remove-broken-link';
  readonly sourcePath: NotePath;
  readonly targetLink: string;
  readonly lineNumber: number;
}

export interface CreateMissingNote {
  readonly kind: 'create-missing-note';
  readonly targetLink: string;
}

export interface ApplyMissingTags {
  readonly kind: 'apply-missing-tags';
  readonly notePath: NotePath;
  readonly tags: ReadonlyArray<TagName>;
}

export type MaintenanceIssueType = 'orphan' | 'broken-link' | 'missing-tags' | 'duplicate';

export interface DismissIssue {
  readonly kind: 'dismiss';
  readonly issueType: MaintenanceIssueType;
  readonly identifier: string;
}
