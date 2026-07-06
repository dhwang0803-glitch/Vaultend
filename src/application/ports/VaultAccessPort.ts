import { Note } from '../../domain/models/Note';
import { NotePath } from '../../domain/values/NotePath';

/**
 * Vault 접근 포트 — Obsidian Vault의 파일 시스템 연산을 추상화한다.
 *
 * 실제 구현은 Obsidian의 vault.read(), vault.modify(), vault.create() 등을 사용하지만,
 * 이 인터페이스 자체는 Obsidian에 대해 아무것도 모른다.
 */
export interface VaultAccessPort {
  /** 노트를 읽어 Note 도메인 모델로 반환. 없으면 null. */
  readNote(path: NotePath): Promise<Note | null>;

  /** 노트를 작성. 이미 존재하면 덮어쓴다. */
  writeNote(path: NotePath, content: string): Promise<void>;

  /** 노트를 삭제. */
  deleteNote(path: NotePath): Promise<void>;

  /** 특정 폴더(또는 전체)의 노트 경로 목록 반환. */
  listNotes(folder?: string): Promise<ReadonlyArray<NotePath>>;

  /** 노트의 프론트매터를 부분 갱신. */
  updateFrontmatter(path: NotePath, updates: Record<string, unknown>): Promise<void>;

  /** 노트 존재 여부 확인. */
  exists(path: NotePath): Promise<boolean>;

  /** 파일 이벤트 감시 등록. 해제를 위한 콜백 반환. */
  watchEvents(handler: VaultEventHandler): () => void;
}

export interface VaultEvent {
  readonly type: 'create' | 'modify' | 'delete' | 'rename';
  readonly path: NotePath;
  readonly oldPath?: NotePath;  // rename 시
}

export type VaultEventHandler = (event: VaultEvent) => void;
