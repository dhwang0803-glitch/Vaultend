export type RefactorGoalType =
  | 'reorganize-notes'
  | 'clean-up-tags'
  | 'suggest-links'
  | 'consolidate-fleeting';

export interface RefactorGoal {
  readonly goalType: RefactorGoalType;
  readonly parameters: RefactorParameters;
}

export interface RefactorParameters {
  readonly fleetingWordCountThreshold?: number;
  readonly targetTagCount?: number;
}

export interface RefactorCostEstimate {
  readonly estimatedAICalls: number;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationSeconds: number;
  readonly noteCount: number;
  readonly chunkCount: number;
  readonly tagCount?: number;
}

export interface NoteMetadataEntry {
  readonly path: string;
  readonly tags: ReadonlyArray<string>;
  readonly links: ReadonlyArray<string>;
  readonly backlinks: ReadonlyArray<string>;
  readonly wordCount: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly folder: string;
  readonly fileSize: number;
}

export interface VaultMetadataSnapshot {
  readonly noteEntries: ReadonlyArray<NoteMetadataEntry>;
  readonly folderTree: ReadonlyArray<string>;
  readonly tagFrequencies: ReadonlyArray<{ tag: string; count: number }>;
  readonly totalNotes: number;
}

export type RefactorPhase = 'collecting' | 'analyzing' | 'synthesizing' | 'converting';

export interface RefactorProgress {
  readonly phase: RefactorPhase;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly message: string;
}
