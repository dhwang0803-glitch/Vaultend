import { MaintenancePlan, DuplicatePair, BrokenLink } from '../../domain/models/OrganizeModels';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath } from '../../domain/values/NotePath';

export class RunMaintenanceUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Vault 전체 유지보수 스캔을 실행한다.
   *
   * 1. 모든 노트 목록 조회
   * 2. 고아 노트 탐지 (백링크 0개)
   * 3. 중복 후보 탐지 (제목 유사도 + 내용 유사도)
   * 4. 깨진 링크 탐지
   * 5. 누락 태그 제안
   * 6. 결과를 MaintenancePlan으로 반환
   */
  async execute(): Promise<MaintenancePlan> {
    const allNotes = await this.vault.listNotes();
    const now = this.clock.now();

    // 고아 노트 탐지
    const orphanNotes = await this.findOrphanNotes(allNotes);

    // 중복 후보 탐지
    const duplicateCandidates = await this.findDuplicates(allNotes);

    // 깨진 링크 탐지
    const brokenLinks = await this.findBrokenLinks(allNotes);

    // 누락 태그 제안
    const missingTags = await this.suggestMissingTags(allNotes);

    return {
      orphanNotes,
      duplicateCandidates,
      brokenLinks,
      missingTags,
      timestamp: now,
    };
  }

  private async findOrphanNotes(allNotes: ReadonlyArray<NotePath>): Promise<NotePath[]> {
    const orphans: NotePath[] = [];
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (note && note.metadata.backlinks.length === 0 && note.metadata.links.length === 0) {
        orphans.push(notePath);
      }
    }
    return orphans;
  }

  private async findDuplicates(allNotes: ReadonlyArray<NotePath>): Promise<DuplicatePair[]> {
    // 제목 유사도 + 검색 인덱스 기반 내용 유사도 비교
    throw new Error('구현 예정');
  }

  private async findBrokenLinks(allNotes: ReadonlyArray<NotePath>): Promise<BrokenLink[]> {
    // [[wikilink]] 파싱 후 대상 노트 존재 여부 확인
    throw new Error('구현 예정');
  }

  private async suggestMissingTags(allNotes: ReadonlyArray<NotePath>): Promise<any[]> {
    // 내용 기반 태그 제안
    throw new Error('구현 예정');
  }
}
