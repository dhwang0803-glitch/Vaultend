import { CorpusStatsPort } from '../../application/ports/CorpusStatsPort';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { TfIdfCorpusStats } from '../../domain/services/TfIdfCorpus';
import { TFIDF_CORPUS_PATH } from '../../constants';

export class FileCorpusStatsAdapter implements CorpusStatsPort {
  constructor(private readonly vault: VaultAccessPort) {}

  async loadStats(): Promise<TfIdfCorpusStats | null> {
    const raw = await this.vault.readFileRaw(TFIDF_CORPUS_PATH);
    if (!raw) return null;

    try {
      const stats: TfIdfCorpusStats = JSON.parse(raw);
      if (typeof stats.documentCount !== 'number' || !stats.documentFrequency) {
        return null;
      }
      return stats;
    } catch {
      return null;
    }
  }

  async saveStats(stats: TfIdfCorpusStats): Promise<void> {
    await this.vault.writeFileRaw(TFIDF_CORPUS_PATH, JSON.stringify(stats));
  }
}
