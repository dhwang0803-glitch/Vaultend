import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName } from '../../domain/values/TagName';
import { createTimestamp } from '../../domain/values/Timestamp';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';

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

    // AI 분류 (content-redact 적용)
    const redactedContent = applyContentRedaction(note.content, [...settings.privacyRules]);
    const classification = await this.aiProvider.callClassification({
      text: redactedContent,
      task: 'classify-and-tag',
      existingTags: settings.knownTags,
    });

    // 링크 제안 — Vault의 다른 노트 제목과 내용 기반
    const allNotes = await this.vault.listNotes();
    const suggestedLinks = this.findRelevantLinks(note.content, allNotes, notePath);

    const result: OrganizeResult = {
      noteId: note.id,
      classifiedCategory: classification.category,
      addedTags: classification.suggestedTags.map(t => createTagName(t)),
      suggestedLinks,
      suggestedMoveTarget: classification.suggestedFolder ?? undefined,
      summary: classification.summary,
    };

    // 자동 적용 모드인 경우 실제 변경 수행
    if (autoApply) {
      await this.applyOrganization(notePath, result);
    }

    return result;
  }

  private findRelevantLinks(
    content: string,
    allNotes: ReadonlyArray<NotePath>,
    excludePath: NotePath,
  ): NotePath[] {
    const contentLower = content.toLowerCase();
    const results: NotePath[] = [];

    for (const notePath of allNotes) {
      if (notePath === excludePath) continue;

      const pathStr = notePath as string;
      const basename = pathStr.split('/').pop()?.replace('.md', '') ?? '';
      if (basename.length < 3) continue;

      if (contentLower.includes(basename.toLowerCase())) {
        results.push(notePath);
      }
    }

    return results;
  }

  private async applyOrganization(
    notePath: NotePath,
    result: OrganizeResult,
  ): Promise<void> {
    const note = await this.vault.readNote(notePath);
    if (!note) return;

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

    await this.history.record({
      id: crypto.randomUUID(),
      action: 'classify',
      notePath,
      timestamp: createTimestamp(Date.now()),
      description: `Organized: category=${result.classifiedCategory}, tags=${result.addedTags.length}`,
    });
  }
}
