import { Note } from '../../domain/models/Note';
import type { NoteMetadataEntry } from '../../domain/models/RefactorModels';
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

  /** 특정 폴더의 파일 경로 목록을 확장자로 필터링하여 반환. */
  listFiles(folder: string, extension: string): Promise<ReadonlyArray<string>>;

  /** 노트의 프론트매터를 부분 갱신. */
  updateFrontmatter(path: NotePath, updates: Record<string, unknown>): Promise<void>;

  /** 노트 존재 여부 확인. */
  exists(path: NotePath): Promise<boolean>;

  /** 노트를 다른 경로로 이동 (링크 자동 갱신). */
  moveNote(from: NotePath, to: NotePath): Promise<void>;

  /** Vault 전체의 태그를 빈도순(내림차)으로 반환. 메타데이터 캐시만 사용하므로 I/O 없음. */
  listAllTags(): Promise<ReadonlyArray<{ tag: string; count: number }>>;

  /** 비-마크다운 파일의 원시 텍스트를 읽는다. 없으면 null. */
  readFileRaw(path: string): Promise<string | null>;

  /** 비-마크다운 파일에 원시 텍스트를 쓴다. 폴더가 없으면 생성한다. */
  writeFileRaw(path: string, content: string): Promise<void>;

  /** Vault 전체 노트의 메타데이터를 일괄 반환. 콘텐츠 I/O 없이 메타데이터 캐시만 사용. */
  listNotesWithMetadata(): Promise<ReadonlyArray<NoteMetadataEntry>>;

  /** 파일 이벤트 감시 등록. 해제를 위한 콜백 반환. */
  watchEvents(handler: VaultEventHandler): () => void;
}

export interface VaultEvent {
  readonly type: 'create' | 'modify' | 'delete' | 'rename';
  readonly path: NotePath;
  readonly oldPath?: NotePath;  // On rename
}

export type VaultEventHandler = (event: VaultEvent) => void;
