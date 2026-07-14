import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName, sanitizeTagName } from '../../domain/values/TagName';
import { createTimestamp } from '../../domain/values/Timestamp';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { TokenUsage } from '../../domain/models/QuickAskModels';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';
import { PromptTemplates } from '../PromptTemplates';
import { getLocale } from '../../i18n';

export class OrganizeNoteUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly config: ConfigPort,
  ) {}

  /**
   * 단일 노트를 정리한다: 분류, 태깅, 링크 제안.
   *
   * 1. 노트 내용 읽기
   * 2. AI에게 분류 및 태그 제안 요청
   * 3. 기존 Vault 노트 목록과 대조하여 링크 제안
   * 4. 프론트매터에 태그 추가 (옵션)
   * 5. 결과 반환
   */
  async execute(notePath: NotePath, autoApply: boolean): Promise<OrganizeResult> {
    const note = await this.vault.readNote(notePath);
    if (!note) {
      throw new NoteNotFoundError(notePath as string);
    }

    const settings = await this.config.getSettings();
    const currentTags = note.metadata.tags.map(t => t as string);

    // Extract vault folder list for AI context (capped to prevent token overflow)
    const allNotes = await this.vault.listNotes();
    const folderSet = new Set<string>();
    for (const np of allNotes) {
      const pathStr = np as string;
      const lastSlash = pathStr.lastIndexOf('/');
      if (lastSlash > 0) {
        folderSet.add(pathStr.substring(0, lastSlash));
      }
    }
    const MAX_FOLDERS = 50;
    const existingFolders = [...folderSet].sort().slice(0, MAX_FOLDERS);

    // Collect vault-wide tags (frequency-sorted, capped)
    const MAX_TAGS = 200;
    const vaultTagEntries = await this.vault.listAllTags();
    const vaultTags = vaultTagEntries.slice(0, MAX_TAGS).map(e => e.tag);

    // Extract current folder for AI context
    const currentFolder = (notePath as string).includes('/')
      ? (notePath as string).substring(0, (notePath as string).lastIndexOf('/'))
      : '';

    // AI classification (content-redact applied)
    const redactedContent = applyContentRedaction(note.content, [...settings.privacyRules]);
    const classification = await this.aiProvider.callClassification({
      text: redactedContent,
      task: 'classify-and-tag',
      existingTags: vaultTags,
      currentNoteTags: currentTags,
      existingFolders,
      currentFolder: currentFolder || undefined,
      locale: getLocale(),
    });

    // Confidence gating — if below threshold, return minimal result
    const confidenceThreshold = settings.inboxConfidenceThreshold ?? 0;
    if (confidenceThreshold > 0 && classification.confidence < confidenceThreshold) {
      return {
        noteId: note.id,
        notePath,
        classifiedCategory: classification.category,
        addedTags: [],
        suggestedLinks: [],
        suggestedMoveTarget: undefined,
        summary: classification.summary,
        tokenUsage: classification.tokenUsage,
        lowConfidence: true,
      };
    }

    // Filter out tags already on the note
    const currentTagsLower = new Set(currentTags.map(t => t.toLowerCase()));
    const newSuggestedTags = classification.suggestedTags
      .filter(t => !currentTagsLower.has(t.toLowerCase()) && !currentTagsLower.has(`#${t}`.toLowerCase()));

    // Link suggestions — AI-based with vault existence validation
    const linkResult = await this.suggestLinksWithAI(redactedContent, allNotes, notePath);
    const suggestedLinks = linkResult.links;

    // Folder suggestion — prefer existing folders, allow new folder creation
    const rawFolder = classification.suggestedFolder;
    const suggestedFolder = rawFolder && rawFolder !== currentFolder
      ? rawFolder
      : undefined;

    const sanitizedTags = newSuggestedTags
      .map(t => sanitizeTagName(t))
      .filter(t => /^#[\w가-힣\-/]+$/.test(t))
      .filter(t => !currentTagsLower.has(t.toLowerCase()));
    const uniqueSanitized = [...new Set(sanitizedTags)];

    const isNewFolder = suggestedFolder ? !folderSet.has(suggestedFolder) : false;

    let historyEntryId: string | undefined;

    const result: OrganizeResult = {
      noteId: note.id,
      notePath,
      classifiedCategory: classification.category,
      addedTags: uniqueSanitized.map(t => createTagName(t)),
      suggestedLinks,
      suggestedMoveTarget: suggestedFolder,
      isNewFolder,
      summary: classification.summary,
      tokenUsage: {
        promptTokens: classification.tokenUsage.promptTokens + linkResult.tokenUsage.promptTokens,
        completionTokens: classification.tokenUsage.completionTokens + linkResult.tokenUsage.completionTokens,
        totalTokens: classification.tokenUsage.totalTokens + linkResult.tokenUsage.totalTokens,
        estimatedCostUsd: classification.tokenUsage.estimatedCostUsd + linkResult.tokenUsage.estimatedCostUsd,
      },
    };

    if (autoApply) {
      historyEntryId = await this.applyOrganization(notePath, result);
    }

    return historyEntryId ? { ...result, historyEntryId } : result;
  }

  private async suggestLinksWithAI(
    content: string,
    allNotes: ReadonlyArray<NotePath>,
    excludePath: NotePath,
  ): Promise<{ links: NotePath[]; tokenUsage: TokenUsage }> {
    const emptyUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    const candidates = allNotes.filter(n => n !== excludePath);
    if (candidates.length === 0) return { links: [], tokenUsage: emptyUsage };

    const MAX_NOTES = 200;
    const noteNames = candidates
      .map(n => (n as string).replace(/\.md$/, ''))
      .slice(0, MAX_NOTES);

    const basenameToPath = new Map<string, NotePath>();
    for (const n of candidates) {
      const basename = ((n as string).split('/').pop()?.replace(/\.md$/, '') ?? '').toLowerCase();
      if (basename.length >= 3 && !basenameToPath.has(basename)) {
        basenameToPath.set(basename, n);
      }
    }
    const fullPathToNote = new Map<string, NotePath>();
    for (const n of candidates) {
      fullPathToNote.set((n as string).replace(/\.md$/, '').toLowerCase(), n);
    }

    try {
      const prompt = PromptTemplates.suggestLinks(content, noteNames);
      const response = await this.aiProvider.callCompletion({
        prompt,
        maxTokens: 300,
        temperature: 0.3,
        jsonMode: true,
      });

      let suggested: unknown;
      try {
        suggested = JSON.parse(response.content);
      } catch {
        return { links: [], tokenUsage: response.tokenUsage };
      }

      if (!Array.isArray(suggested)) return { links: [], tokenUsage: response.tokenUsage };

      const validated: NotePath[] = [];
      const seen = new Set<string>();

      for (const name of suggested) {
        if (typeof name !== 'string') continue;
        const normalized = name.replace(/\.md$/, '').toLowerCase();

        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const byFullPath = fullPathToNote.get(normalized);
        if (byFullPath) {
          validated.push(byFullPath);
          continue;
        }

        const basenameOnly = normalized.split('/').pop() ?? '';
        const byBasename = basenameToPath.get(basenameOnly);
        if (byBasename) {
          validated.push(byBasename);
        }
      }

      return { links: validated, tokenUsage: response.tokenUsage };
    } catch {
      return { links: [], tokenUsage: emptyUsage };
    }
  }

  private async applyOrganization(
    notePath: NotePath,
    result: OrganizeResult,
  ): Promise<string> {
    const note = await this.vault.readNote(notePath);
    if (!note) return '';
    const previousContent = note.content;

    if (result.addedTags.length > 0) {
      const existingTags = note.metadata.tags.map(t => t as string);
      const newTags = result.addedTags
        .map(t => t as string)
        .filter(t => !existingTags.includes(t));
      if (newTags.length > 0) {
        await this.vault.updateFrontmatter(notePath, {
          tags: [...existingTags, ...newTags],
        });
      }
    }

    if (result.suggestedLinks.length > 0) {
      const currentNote = await this.vault.readNote(notePath);
      if (currentNote) {
        const linkLines = result.suggestedLinks.map(link => {
          const linkPath = (link as string).replace('.md', '');
          return `- [[${linkPath}]]`;
        });
        const section = `\n\n## Related Notes\n\n${linkLines.join('\n')}`;
        await this.vault.writeNote(notePath, currentNote.content + section);
      }
    }

    if (result.suggestedMoveTarget) {
      const filename = (notePath as string).split('/').pop() ?? '';
      const newPath = createNotePath(`${result.suggestedMoveTarget as string}/${filename}`);
      const currentNote = await this.vault.readNote(notePath);
      if (currentNote) {
        await this.vault.writeNote(newPath, currentNote.content);
        await this.vault.updateFrontmatter(newPath, { processed: true });
        await this.vault.deleteNote(notePath);
      }
    }

    const entryId = crypto.randomUUID();
    await this.history.record({
      id: entryId,
      action: 'classify',
      notePath,
      timestamp: createTimestamp(Date.now()),
      description: `Organized: folder=${result.suggestedMoveTarget ?? 'keep'}, tags=${result.addedTags.length}`,
      previousContent,
      metadata: {
        tags: result.addedTags.map(t => t as string),
        links: result.suggestedLinks.map(l => l as string),
        moveTarget: result.suggestedMoveTarget,
      },
    });
    return entryId;
  }
}
