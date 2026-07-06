import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName } from '../../domain/values/TagName';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
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
      throw new Error(`노트를 찾을 수 없습니다: ${notePath}`);
    }

    const settings = await this.config.getSettings();

    // AI 분류
    const classification = await this.aiProvider.callClassification({
      text: note.content,
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
      suggestedMoveTarget: classification.suggestedFolder
        ? createNotePath(classification.suggestedFolder)
        : undefined,
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
    // 다른 노트 제목이 현재 내용에 언급되어 있는지 확인
    throw new Error('구현 예정');
  }

  private async applyOrganization(
    notePath: NotePath,
    result: OrganizeResult,
  ): Promise<void> {
    // 프론트매터에 태그 추가, 링크 삽입 등
    throw new Error('구현 예정');
  }
}
