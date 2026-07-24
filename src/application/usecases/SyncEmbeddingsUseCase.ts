import { EmbeddingPort } from '../ports/EmbeddingPort';
import { VectorStorePort } from '../ports/VectorStorePort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ChangeTrackingPort } from '../ports/ChangeTrackingPort';
import { ConfigPort } from '../ports/ConfigPort';
import { NotePath } from '../../domain/values/NotePath';
import { isNoteAllowedByRules, applyContentRedaction } from '../../domain/models/PrivacyRule';

export class SyncEmbeddingsUseCase {
  constructor(
    private readonly embedding: EmbeddingPort,
    private readonly vectorStore: VectorStorePort,
    private readonly vault: VaultAccessPort,
    private readonly changeTracking: ChangeTrackingPort,
    private readonly config: ConfigPort,
  ) {}

  async execute(): Promise<{ indexed: number; skipped: number }> {
    if (!this.embedding.isReady()) {
      const initialized = await this.embedding.initialize();
      if (!initialized) return { indexed: 0, skipped: 0 };
    }

    const dirtySet = await this.changeTracking.getDirtySet();
    if (dirtySet.size === 0) return { indexed: 0, skipped: 0 };

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    let indexed = 0;
    let skipped = 0;

    for (const notePath of dirtySet) {
      const note = await this.vault.readNote(notePath);
      if (!note) {
        await this.vectorStore.remove(notePath);
        skipped++;
        continue;
      }

      const tags = note.metadata.tags.map(t => t as string);
      if (!isNoteAllowedByRules(notePath, tags, note.metadata.frontmatterEntries, privacyRules)) {
        await this.vectorStore.remove(notePath);
        skipped++;
        continue;
      }

      await this.vectorStore.remove(notePath);

      for (let i = 0; i < note.chunks.length; i++) {
        const chunkText = applyContentRedaction(note.chunks[i].text, privacyRules);
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

    const note = await this.vault.readNote(notePath);
    if (!note) {
      await this.vectorStore.remove(notePath);
      return;
    }

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    const tags = note.metadata.tags.map(t => t as string);
    if (!isNoteAllowedByRules(notePath, tags, note.metadata.frontmatterEntries, privacyRules)) {
      await this.vectorStore.remove(notePath);
      return;
    }

    await this.vectorStore.remove(notePath);

    for (let i = 0; i < note.chunks.length; i++) {
      const chunkText = applyContentRedaction(note.chunks[i].text, privacyRules);
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

    await this.vectorStore.clearEntries();
    const allNotes = await this.vault.listNotes();
    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];
    let count = 0;

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const tags = note.metadata.tags.map(t => t as string);
      if (!isNoteAllowedByRules(notePath, tags, note.metadata.frontmatterEntries, privacyRules)) {
        continue;
      }

      for (let i = 0; i < note.chunks.length; i++) {
        const chunkText = applyContentRedaction(note.chunks[i].text, privacyRules);
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
