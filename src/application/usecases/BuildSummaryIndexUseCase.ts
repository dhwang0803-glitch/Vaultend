import { TokenUsage } from '../../domain/models/TokenUsage';
import { NotePath } from '../../domain/values/NotePath';
import { NoteEmbeddingService } from '../../domain/services/NoteEmbeddingService';
import { SummaryIndexService, SummaryBatchItem } from '../../domain/services/SummaryIndexService';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
import { stripFrontmatter } from '../../domain/services/tokenize';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import { NoteEmbeddingCachePort } from '../ports/NoteEmbeddingCachePort';
import { ConfigPort } from '../ports/ConfigPort';
import { PromptTemplates } from '../PromptTemplates';
import { detectContentLanguage } from '../utils/detectContentLanguage';

export interface BuildSummaryIndexOptions {
  readonly forceRebuild?: boolean;
  readonly onProgress?: (processed: number, total: number) => void;
}

export interface SummaryIndexResult {
  readonly totalNotes: number;
  readonly processedNotes: number;
  readonly skippedNotes: number;
  readonly tokenUsage: TokenUsage;
}

const NON_TEXT_EXTENSIONS = ['.excalidraw.md', '.canvas'];

export class BuildSummaryIndexUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly aiProvider: AIProviderPort,
    private readonly noteEmbeddingCache: NoteEmbeddingCachePort,
    private readonly config: ConfigPort,
  ) {}

  async execute(options?: BuildSummaryIndexOptions): Promise<SummaryIndexResult> {
    const allNotes = await this.vault.listNotes();
    const textNotes = allNotes.filter(
      np => !NON_TEXT_EXTENSIONS.some(ext => (np as string).toLowerCase().endsWith(ext)),
    );

    await this.noteEmbeddingCache.load();

    const settings = await this.config.getSettings();
    const privacyRules = [...settings.privacyRules];

    const needsProcessing: Array<{ notePath: NotePath; title: string; content: string; contentHash: string }> = [];

    for (const notePath of textNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const title = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
      const redactedContent = applyContentRedaction(note.content, privacyRules);
      const body = stripFrontmatter(redactedContent).slice(0, 8000);
      const contentHash = await NoteEmbeddingService.computeContentHash(title, body);

      if (!options?.forceRebuild && !this.needsSummaryUpdate(notePath, contentHash)) {
        continue;
      }

      needsProcessing.push({ notePath, title, content: redactedContent, contentHash });
    }

    if (needsProcessing.length === 0) {
      return {
        totalNotes: textNotes.length,
        processedNotes: 0,
        skippedNotes: textNotes.length,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      };
    }

    const batchItems = SummaryIndexService.buildBatchItems(needsProcessing);
    const batches: SummaryBatchItem[][] = [];
    for (let i = 0; i < batchItems.length; i += SummaryIndexService.BATCH_SIZE) {
      batches.push(batchItems.slice(i, i + SummaryIndexService.BATCH_SIZE));
    }

    const sampleContent = needsProcessing[0]?.content ?? '';
    const lang = detectContentLanguage(sampleContent);

    const { processedCount, tokenUsage } = await this.processBatchesConcurrently(
      batches,
      needsProcessing,
      lang,
      options?.onProgress,
    );

    await this.noteEmbeddingCache.flush();

    return {
      totalNotes: textNotes.length,
      processedNotes: processedCount,
      skippedNotes: textNotes.length - processedCount,
      tokenUsage,
    };
  }

  private needsSummaryUpdate(notePath: NotePath, currentContentHash: string): boolean {
    const cached = this.noteEmbeddingCache.get(notePath);
    if (!cached) return true;
    if (cached.contentHash !== currentContentHash) return true;
    if (!cached.onelineSummary) return true;
    return false;
  }

  private async processBatchesConcurrently(
    batches: SummaryBatchItem[][],
    noteData: ReadonlyArray<{ notePath: NotePath; contentHash: string }>,
    lang: 'en' | 'ko',
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ processedCount: number; tokenUsage: TokenUsage }> {
    const hashMap = new Map<string, string>();
    for (const nd of noteData) {
      hashMap.set(nd.notePath, nd.contentHash);
    }

    const tokenUsages: TokenUsage[] = [];
    let processed = 0;
    const total = batches.reduce((sum, b) => sum + b.length, 0);

    for (let i = 0; i < batches.length; i += SummaryIndexService.MAX_CONCURRENT_BATCHES) {
      const chunk = batches.slice(i, i + SummaryIndexService.MAX_CONCURRENT_BATCHES);
      const settled = await Promise.allSettled(
        chunk.map(batch => this.processSingleBatch(batch, lang)),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          for (const sr of result.value.results) {
            const contentHash = hashMap.get(sr.notePath) ?? '';
            this.noteEmbeddingCache.put({
              notePath: sr.notePath,
              vector: new Float32Array(0),
              contentHash,
              onelineSummary: sr.onelineSummary,
            });
          }
          tokenUsages.push(result.value.tokenUsage);
          processed += result.value.results.length;
        }
      }
      onProgress?.(processed, total);
    }

    const aggregated: TokenUsage = tokenUsages.reduce(
      (acc, t) => ({
        promptTokens: acc.promptTokens + t.promptTokens,
        completionTokens: acc.completionTokens + t.completionTokens,
        totalTokens: acc.totalTokens + t.totalTokens,
        estimatedCostUsd: acc.estimatedCostUsd + t.estimatedCostUsd,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    );

    return { processedCount: processed, tokenUsage: aggregated };
  }

  private async processSingleBatch(
    batch: ReadonlyArray<SummaryBatchItem>,
    lang: 'en' | 'ko',
  ): Promise<{ results: Array<{ notePath: NotePath; onelineSummary: string }>; tokenUsage: TokenUsage }> {
    const systemPrompt = PromptTemplates.batchSummarySystemPrompt(lang);
    const prompt = PromptTemplates.batchSummaryUserMessage(
      batch.map(b => ({ index: b.index, title: b.title, contentExcerpt: b.contentExcerpt })),
      lang,
    );
    const maxTokens = Math.min(2000, Math.max(200, batch.length * 40));

    const response = await this.aiProvider.callCompletion({
      prompt,
      systemPrompt,
      maxTokens,
      temperature: 0.1,
      jsonMode: true,
    });

    const results = SummaryIndexService.parseBatchSummaryResponse(response.content, batch);
    return { results, tokenUsage: response.tokenUsage };
  }
}
