import type { RefactorGoal, RefactorCostEstimate, VaultMetadataSnapshot } from '../../domain/models/RefactorModels';
import {
  REFACTOR_BATCH_SIZE,
  REFACTOR_MAX_TAGS_IN_PROMPT,
  FLEETING_WORD_COUNT_THRESHOLD,
  FLEETING_MIN_CLUSTER_SIZE,
  MISPLACED_BATCH_SIZE,
  BLOATED_FOLDER_THRESHOLD,
  THIN_FOLDER_THRESHOLD,
  PROMOTE_MATURITY_AGE_DAYS,
  PROMOTE_MIN_WORD_COUNT,
  DEFAULT_FLEETING_FOLDERS,
} from '../../constants';

const COST_PER_AI_CALL_USD = 0.012;
const SECONDS_PER_AI_CALL = 8;

export class EstimateRefactorCostUseCase {
  execute(goal: RefactorGoal, snapshot: VaultMetadataSnapshot): RefactorCostEstimate {
    switch (goal.goalType) {
      case 'reorganize-notes':
        return this.estimateReorganize(snapshot);
      case 'clean-up-tags':
        return this.estimateTagCleanup(snapshot);
      case 'suggest-links':
        return this.estimateLinkSuggestions(snapshot);
      case 'consolidate-fleeting':
        return this.estimateFleetingNotes(goal, snapshot);
      case 'detect-misplaced':
        return this.estimateMisplaced(snapshot, goal);
      case 'optimize-folders':
        return this.estimateFolderOptimization(snapshot, goal);
      case 'promote-fleeting':
        return this.estimateFleetingPromotion(snapshot, goal);
    }
  }

  private estimateReorganize(snapshot: VaultMetadataSnapshot): RefactorCostEstimate {
    const orphanCount = snapshot.noteEntries.filter(
      n => n.backlinks.length === 0 && n.links.length === 0,
    ).length;
    const emptyCount = snapshot.noteEntries.filter(
      n => n.wordCount === 0 && n.backlinks.length === 0 && n.links.length > 0,
    ).length;
    const noteCount = orphanCount + emptyCount;
    const chunkCount = Math.ceil(orphanCount / REFACTOR_BATCH_SIZE);
    const analysisAICalls = chunkCount;
    const tier2AICalls = 1;
    const estimatedAICalls = analysisAICalls + tier2AICalls;

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount,
      chunkCount,
    };
  }

  private estimateTagCleanup(snapshot: VaultMetadataSnapshot): RefactorCostEstimate {
    const tagCount = snapshot.tagFrequencies.length;
    const untaggedCount = snapshot.noteEntries.filter(
      n => n.tags.filter(t => t !== '#untagged').length === 0 && n.wordCount > 0,
    ).length;
    const noteCount = snapshot.totalNotes;
    const tagChunkCount = Math.ceil(tagCount / REFACTOR_MAX_TAGS_IN_PROMPT);
    const untaggedChunkCount = Math.ceil(untaggedCount / REFACTOR_BATCH_SIZE);
    const synthesisAICalls = 1;
    const estimatedAICalls = tagChunkCount + synthesisAICalls + untaggedChunkCount;

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount,
      chunkCount: tagChunkCount + untaggedChunkCount,
      tagCount,
    };
  }

  private estimateLinkSuggestions(snapshot: VaultMetadataSnapshot): RefactorCostEstimate {
    const orphanCount = snapshot.noteEntries.filter(
      n => n.backlinks.length === 0 && n.links.length === 0,
    ).length;
    const chunkCount = Math.ceil(orphanCount / REFACTOR_BATCH_SIZE);
    const brokenLinkScanCalls = 1;
    const estimatedAICalls = chunkCount + brokenLinkScanCalls;

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount: orphanCount + snapshot.totalNotes,
      chunkCount,
    };
  }

  private estimateFleetingNotes(
    goal: RefactorGoal,
    snapshot: VaultMetadataSnapshot,
  ): RefactorCostEstimate {
    const threshold = goal.parameters.fleetingWordCountThreshold ?? FLEETING_WORD_COUNT_THRESHOLD;
    const candidates = snapshot.noteEntries.filter(
      n => n.wordCount < threshold && n.tags.length <= 1 && n.links.length <= 1,
    );
    const estimatedClusters = Math.max(1, Math.floor(candidates.length / FLEETING_MIN_CLUSTER_SIZE));
    const estimatedAICalls = estimatedClusters + 1;

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount: candidates.length,
      chunkCount: estimatedClusters,
    };
  }

  private estimateMisplaced(snapshot: VaultMetadataSnapshot, _goal: RefactorGoal): RefactorCostEstimate {
    const connectedCount = snapshot.noteEntries.filter(
      n => n.links.length > 0 || n.backlinks.length > 0,
    ).length;
    const estimatedCandidates = Math.ceil(connectedCount * 0.15);
    const chunkCount = Math.ceil(estimatedCandidates / MISPLACED_BATCH_SIZE);
    const estimatedAICalls = Math.max(1, chunkCount);

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount: connectedCount,
      chunkCount,
    };
  }

  private estimateFolderOptimization(snapshot: VaultMetadataSnapshot, goal: RefactorGoal): RefactorCostEstimate {
    const bloatedThreshold = goal.parameters.bloatedFolderThreshold ?? BLOATED_FOLDER_THRESHOLD;
    const thinThreshold = goal.parameters.thinFolderThreshold ?? THIN_FOLDER_THRESHOLD;

    const folderCounts = new Map<string, number>();
    for (const note of snapshot.noteEntries) {
      if (!note.folder) continue;
      folderCounts.set(note.folder, (folderCounts.get(note.folder) ?? 0) + 1);
    }

    const bloatedCount = [...folderCounts.values()].filter(c => c > bloatedThreshold).length;
    const thinCount = [...folderCounts.values()].filter(c => c > 0 && c < thinThreshold).length;
    const estimatedAICalls = bloatedCount + (thinCount > 1 ? 1 : 0);

    return {
      estimatedAICalls: Math.max(1, estimatedAICalls),
      estimatedCostUsd: round(Math.max(1, estimatedAICalls) * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: Math.max(1, estimatedAICalls) * SECONDS_PER_AI_CALL,
      noteCount: snapshot.totalNotes,
      chunkCount: bloatedCount + (thinCount > 1 ? 1 : 0),
    };
  }

  private estimateFleetingPromotion(snapshot: VaultMetadataSnapshot, goal: RefactorGoal): RefactorCostEstimate {
    const fleetingFolders = goal.parameters.fleetingFolders ?? DEFAULT_FLEETING_FOLDERS;
    const maturityAgeDays = goal.parameters.maturityAgeDays ?? PROMOTE_MATURITY_AGE_DAYS;
    const maturityMinWordCount = goal.parameters.maturityMinWordCount ?? PROMOTE_MIN_WORD_COUNT;
    const maturityAgeMs = maturityAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const fleetingSet = new Set(fleetingFolders.map(f => f.toLowerCase()));
    const matureCount = snapshot.noteEntries.filter(note => {
      if (!note.folder) return false;
      const folderLower = note.folder.toLowerCase();
      const isInFleeting = [...fleetingSet].some(f => folderLower === f || folderLower.startsWith(f + '/'));
      if (!isInFleeting) return false;
      return (now - note.createdAt) >= maturityAgeMs
        && note.wordCount >= maturityMinWordCount
        && note.tags.length > 0
        && (note.links.length > 0 || note.backlinks.length > 0);
    }).length;

    const chunkCount = Math.ceil(matureCount / REFACTOR_BATCH_SIZE);
    const estimatedAICalls = Math.max(1, chunkCount);

    return {
      estimatedAICalls,
      estimatedCostUsd: round(estimatedAICalls * COST_PER_AI_CALL_USD),
      estimatedDurationSeconds: estimatedAICalls * SECONDS_PER_AI_CALL,
      noteCount: matureCount,
      chunkCount,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
