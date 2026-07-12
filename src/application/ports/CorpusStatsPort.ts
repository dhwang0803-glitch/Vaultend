import { TfIdfCorpusStats } from '../../domain/services/TfIdfCorpus';

export interface CorpusStatsPort {
  loadStats(): Promise<TfIdfCorpusStats | null>;
  saveStats(stats: TfIdfCorpusStats): Promise<void>;
}
