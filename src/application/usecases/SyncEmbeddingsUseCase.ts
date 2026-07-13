import { EmbeddingPort } from '../ports/EmbeddingPort';
import { VectorStorePort } from '../ports/VectorStorePort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ChangeTrackingPort } from '../ports/ChangeTrackingPort';
import { NotePath } from '../../domain/values/NotePath';

export class SyncEmbeddingsUseCase {
  constructor(
    private readonly embedding: EmbeddingPort,
    private readonly vectorStore: VectorStorePort,
    private readonly vault: VaultAccessPort,
    private readonly changeTracking: ChangeTrackingPort,
  ) {}

  async execute(): Promise<{ indexed: number; skipped: number }> {
    if (!this.embedding.isReady()) {
      const initialized = await this.embedding.initialize();
      if (!initialized) return { indexed: 0, skipped: 0 };
    }

    const dirtySet = await this.changeTracking.getDirtySet();
    if (dirtySet.size === 0) return { indexed: 0, skipped: 0 };

    let indexed = 0;
    let skipped = 0;

    for (const notePath of dirtySet) {
      const note = await this.vault.readNote(notePath);
      if (!note) {
        await this.vectorStore.remove(notePath);
        skipped++;
        continue;
      }

      await this.vectorStore.remove(notePath);

      for (let i = 0; i < note.chunks.length; i++) {
        const chunkText = note.chunks[i].text as string;
        if (chunkText.trim().length < 10) continue;

        const vector = await this.embedding.embed(chunkText);
        await this.vectorStore.upsert(notePath, note.chunks[i].startLine, vector);
      }
      indexed++;
    }

    await this.vectorStore.flush();
    return { indexed, skipped };
  }

  async syncSingle(notePath: NotePath): Promise<void> {
    if (!this.embedding.isReady()) return;

    await this.vectorStore.remove(notePath);

    const note = await this.vault.readNote(notePath);
    if (!note) return;

    for (let i = 0; i < note.chunks.length; i++) {
      const chunkText = note.chunks[i].text as string;
      if (chunkText.trim().length < 10) continue;
      const vector = await this.embedding.embed(chunkText);
      await this.vectorStore.upsert(notePath, note.chunks[i].startLine, vector);
    }
    await this.vectorStore.flush();
  }

  async rebuildAll(): Promise<number> {
    if (!this.embedding.isReady()) {
      const initialized = await this.embedding.initialize();
      if (!initialized) return 0;
    }

    await this.vectorStore.clear();
    const allNotes = await this.vault.listNotes();
    let count = 0;

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      for (let i = 0; i < note.chunks.length; i++) {
        const chunkText = note.chunks[i].text as string;
        if (chunkText.trim().length < 10) continue;

        const vector = await this.embedding.embed(chunkText);
        await this.vectorStore.upsert(notePath, note.chunks[i].startLine, vector);
      }
      count++;
    }

    await this.vectorStore.flush();
    return count;
  }
}
