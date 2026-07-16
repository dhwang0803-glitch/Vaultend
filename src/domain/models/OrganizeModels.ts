import { TagName } from '../values/TagName';
import { NotePath } from '../values/NotePath';
import { NoteId } from '../values/NoteId';
import { Timestamp } from '../values/Timestamp';
import { TokenUsage } from './QuickAskModels';

/**
 * OrganizeResult — 단일 노트 정리 결과.
 */
export interface OrganizeResult {
  readonly noteId: NoteId;
  readonly notePath: NotePath;
  readonly classifiedCategory: string;
  readonly addedTags: ReadonlyArray<TagName>;
  readonly suggestedLinks: ReadonlyArray<NotePath>;
  readonly suggestedMoveTarget?: string;
  readonly isNewFolder?: boolean;
  readonly summary: string;
  readonly tokenUsage: TokenUsage;
  readonly lowConfidence?: boolean;
  readonly historyEntryId?: string;
}

/**
 * MaintenancePlan — Vault 전체 유지보수 계획.
 */
export interface MaintenancePlan {
  readonly orphanNotes: ReadonlyArray<OrphanNoteEntry>;
  readonly duplicateCandidates: ReadonlyArray<DuplicatePair>;
  readonly missingTags: ReadonlyArray<MissingTagSuggestion>;
  readonly brokenLinks: ReadonlyArray<BrokenLink>;
  readonly emptyNotes: ReadonlyArray<EmptyNoteEntry>;
  readonly untaggedNotes: ReadonlyArray<NotePath>;
  readonly duplicateTags: ReadonlyArray<DuplicateTagGroup>;
  readonly timestamp: Timestamp;
}

export interface OrphanNoteEntry {
  readonly notePath: NotePath;
  readonly fileSize: number;
}

export interface EmptyNoteEntry {
  readonly notePath: NotePath;
  readonly backlinkCount: number;
  readonly backlinkPaths: ReadonlyArray<NotePath>;
}

export interface DuplicatePair {
  readonly noteA: NotePath;
  readonly noteB: NotePath;
  readonly similarityScore: number;
  readonly reason: string;
}

export interface MissingTagSuggestion {
  readonly notePath: NotePath;
  readonly suggestedTags: ReadonlyArray<TagName>;
  readonly reason: string;
}

export interface BrokenLink {
  readonly sourcePath: NotePath;
  readonly targetLink: string;
  readonly lineNumber: number;
}

export interface DuplicateTagGroup {
  readonly canonicalTag: TagName;
  readonly variants: ReadonlyArray<{ tag: TagName; count: number }>;
  readonly affectedNotes: ReadonlyArray<NotePath>;
}
