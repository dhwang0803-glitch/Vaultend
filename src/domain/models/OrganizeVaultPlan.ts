import { NotePath } from '../values/NotePath';
import { TagName } from '../values/TagName';
import { Timestamp } from '../values/Timestamp';

export type OrganizeVaultStatus = 'draft' | 'applied' | 'rolled-back';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export type ProposalType =
  | 'reposition'
  | 'fix-broken-link'
  | 'merge-duplicate-tags'
  | 'apply-missing-tags'
  | 'archive-empty'
  | 'merge-duplicate-notes'
  | 'misplaced-reposition'
  | 'split-folder'
  | 'merge-folders'
  | 'promote-note';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function classifyConfidence(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

export interface ProposalDiff {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface OrganizeVaultProposal {
  readonly id: string;
  readonly type: ProposalType;
  readonly targetPath: NotePath;
  readonly diffs: ReadonlyArray<ProposalDiff>;
  readonly affectedPaths: ReadonlyArray<NotePath>;
  readonly confidence: number;
  readonly confidenceLevel: ConfidenceLevel;
  readonly rationale: string;
  readonly status: ProposalStatus;
  readonly metadata?: Record<string, unknown>;
}

export interface OrganizeVaultPlan {
  readonly id: string;
  readonly timestamp: Timestamp;
  readonly proposals: ReadonlyArray<OrganizeVaultProposal>;
  readonly status: OrganizeVaultStatus;
  readonly appliedAt?: Timestamp;
  readonly rolledBackAt?: Timestamp;
  readonly transactionId?: string;
}

export interface RepositionDetail {
  readonly suggestedFolder: string;
  readonly suggestedTags: ReadonlyArray<TagName>;
  readonly suggestedLinks: ReadonlyArray<NotePath>;
  readonly isNewFolder: boolean;
}

export interface FixBrokenLinkDetail {
  readonly sourcePath: NotePath;
  readonly brokenLink: string;
  readonly suggestedTarget: string;
  readonly lineNumber: number;
}

export interface MergeDuplicateTagsDetail {
  readonly keepTag: TagName;
  readonly replaceTags: ReadonlyArray<TagName>;
  readonly affectedNotes: ReadonlyArray<NotePath>;
}

export interface MergeDuplicateNotesDetail {
  readonly survivorPath: string;
  readonly donorPath: string;
  readonly mergedContent: string;
  readonly mergedTags: ReadonlyArray<string>;
  readonly sourceBlock: string;
  readonly backlinksToRedirect: ReadonlyArray<string>;
}

export interface MisplacedRepositionDetail {
  readonly currentFolder: string;
  readonly suggestedFolder: string;
  readonly suggestedTags: ReadonlyArray<string>;
  readonly suggestedLinks: ReadonlyArray<string>;
  readonly affinityScore: number;
  readonly topConnections: ReadonlyArray<{ path: string; folder: string }>;
}

export interface SplitFolderDetail {
  readonly sourceFolder: string;
  readonly suggestedSubfolders: ReadonlyArray<{
    name: string;
    noteCount: number;
    notes: ReadonlyArray<string>;
  }>;
}

export interface MergeFoldersDetail {
  readonly folders: ReadonlyArray<string>;
  readonly suggestedMergedFolder: string;
  readonly totalNoteCount: number;
}

export interface PromoteNoteDetail {
  readonly currentFolder: string;
  readonly suggestedFolder: string;
  readonly maturitySignals: {
    readonly ageDays: number;
    readonly wordCount: number;
    readonly tagCount: number;
    readonly linkCount: number;
  };
}

export function createOrganizeVaultPlan(
  proposals: ReadonlyArray<OrganizeVaultProposal>,
  timestamp: Timestamp,
): OrganizeVaultPlan {
  return {
    id: crypto.randomUUID(),
    timestamp,
    proposals,
    status: 'draft',
  };
}

export function createProposal(params: {
  type: ProposalType;
  targetPath: NotePath;
  diffs: ReadonlyArray<ProposalDiff>;
  affectedPaths: ReadonlyArray<NotePath>;
  confidence: number;
  rationale: string;
  metadata?: Record<string, unknown>;
}): OrganizeVaultProposal {
  return {
    id: crypto.randomUUID(),
    type: params.type,
    targetPath: params.targetPath,
    diffs: params.diffs,
    affectedPaths: params.affectedPaths,
    confidence: params.confidence,
    confidenceLevel: classifyConfidence(params.confidence),
    rationale: params.rationale,
    status: 'pending',
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function withProposalStatus(
  proposal: OrganizeVaultProposal,
  status: ProposalStatus,
): OrganizeVaultProposal {
  return { ...proposal, status };
}

export function withPlanStatus(
  plan: OrganizeVaultPlan,
  status: OrganizeVaultStatus,
  timestamp?: Timestamp,
): OrganizeVaultPlan {
  if (status === 'applied' && timestamp) {
    return {
      ...plan,
      status,
      appliedAt: timestamp,
      transactionId: crypto.randomUUID(),
    };
  }
  if (status === 'rolled-back' && timestamp) {
    return { ...plan, status, rolledBackAt: timestamp };
  }
  return { ...plan, status };
}

export function getApprovedProposals(
  plan: OrganizeVaultPlan,
): ReadonlyArray<OrganizeVaultProposal> {
  return plan.proposals.filter(p => p.status === 'approved');
}

export function countByType(
  proposals: ReadonlyArray<OrganizeVaultProposal>,
): Record<ProposalType, number> {
  const counts: Record<string, number> = {};
  for (const p of proposals) {
    counts[p.type] = (counts[p.type] ?? 0) + 1;
  }
  return counts as Record<ProposalType, number>;
}
