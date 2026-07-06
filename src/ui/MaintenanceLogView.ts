import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GetHistoryUseCase } from '../application/usecases/GetHistoryUseCase';

export const MAINTENANCE_LOG_VIEW_TYPE = 'knowledge-maintenance-log';

/**
 * 유지보수 로그 사이드바 뷰 — 플러그인의 활동 이력을 표시한다.
 *
 * 최근 수행된 자동 태깅, 분류, 링크 제안, 중복 탐지 등의
 * 결과를 시간순으로 보여준다.
 */
export class MaintenanceLogView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly getHistory: GetHistoryUseCase,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return MAINTENANCE_LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Maintenance Log';
  }

  getIcon(): string {
    return 'wrench';
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h4', { text: '유지보수 활동 로그' });

    const entries = await this.getHistory.execute({ limit: 50 });

    if (entries.length === 0) {
      contentEl.createEl('p', {
        text: '아직 기록된 활동이 없습니다.',
        cls: 'knowledge-maintenance-empty',
      });
      return;
    }

    const listEl = contentEl.createEl('ul', { cls: 'knowledge-maintenance-log-list' });
    for (const entry of entries) {
      const li = listEl.createEl('li');
      const time = new Date(entry.timestamp as number).toLocaleString('ko-KR');
      li.createEl('span', { text: `[${time}] `, cls: 'log-timestamp' });
      li.createEl('span', { text: `${entry.action}: `, cls: 'log-action' });
      li.createEl('span', { text: entry.description, cls: 'log-description' });
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
