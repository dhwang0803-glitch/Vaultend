# Architecture

> 프로젝트 전체 아키텍처(레이어/흐름/경계)를 기술한다. (`docs` 브랜치에서만 편집)
> 데이터 경로·실행 모드·Repository 간 쓰기 순서가 바뀌면 갱신한다.

## 레이어 개요

Obsidian 플러그인이므로 별도 서버 없이, Plugin 클래스(`main.ts`)가 Composition Root 역할을 한다.

```
┌─────────────────────────────────────────────────┐
│ UI Layer           src/ui/                       │
│   QuickAskModal, MaintenanceResultView,          │
│   MaintenanceLogView, OrganizeFolderResultView,  │
│   PluginSettingTab                               │
├─────────────────────────────────────────────────┤
│ Composition Root   src/main.ts                   │
│   VaultendPlugin (DI 조립)                       │
├─────────────────────────────────────────────────┤
│ Application Layer  src/application/              │
│   UseCases: QuickAsk, OrganizeNote, Inbox,       │
│             Maintenance, Save, Clipboard,        │
│             SyncEmbeddings                       │
│   Ports (ABC): AIProvider, VaultAccess,          │
│                SearchIndex, History, Config,      │
│                Clipboard, Clock, Embedding,       │
│                VectorStore, ChangeTracking,       │
│                CorpusStats                        │
├─────────────────────────────────────────────────┤
│ Domain Layer       src/domain/                   │
│   Values: NoteId, NotePath, NoteTitle, ChunkText,│
│           HeadingPath, TagName, Timestamp         │
│   Models: Note, NoteChunk, NoteMetadata,         │
│           SaveTarget, QuickAsk/OrganizeModels,    │
│           PrivacyRule, HistoryEntry              │
│   Services: TfIdfCorpus, tokenize               │
│   Errors: DomainErrors                           │
├─────────────────────────────────────────────────┤
│ Adapters Layer     src/adapters/                 │
│   vault/       → ObsidianVaultAdapter            │
│   ai/          → OpenAI/Gemini/DynamicAIAdapter  │
│   search/      → JsonSearchIndexAdapter          │
│   history/     → FileHistoryAdapter              │
│   clipboard/   → ObsidianClipboardAdapter        │
│   clock/       → SystemClockAdapter              │
│   embedding/   → AIEmbeddingAdapter              │
│   vectorstore/ → JsonVectorStoreAdapter          │
│   tracking/    → FileChangeTrackingAdapter       │
│   corpus/      → FileCorpusStatsAdapter          │
└─────────────────────────────────────────────────┘
```

## 의존성 방향

```
domain (values, models, errors)     ← 최내곽: 외부 의존 없음
    ↑
application (ports ABC, usecases)   ← domain만 import, Port 인터페이스로 어댑터 격리
    ↑
adapters (vault, ai, search, ...)   ← application/ports + 외부 라이브러리
    ↑
main.ts (Composition Root)          ← 모든 계층 조립, Obsidian Plugin API
    ↑
ui/ (Modal, View, SettingTab)       ← main.ts에서 UseCase 주입받아 사용
```

## 데이터 흐름 (대표 시나리오)

### Quick Ask (AI 질의 + Hybrid Search)

```
[사용자] → QuickAskModal.onSubmit()
  → QuickAskUseCase.execute(question)
    → hybridSearch(question)
      → SearchIndexPort.search(question)     → BM25 top-20
      → EmbeddingPort.embed(question)        → 쿼리 벡터 생성 (opt-in)
      → VectorStorePort.search(vec, 20)      → 시맨틱 top-20 (opt-in)
      → RRF merge (k=60)                    → 최종 상위 N 청크
    → AIProviderPort.ask(prompt, context) → AI 응답 생성
    → SaveNoteUseCase.execute(response)  → 응답 저장
    → HistoryPort.append(entry)          → 이력 기록
  ← QuickAskResult (answer, sources, savedPath)
```

> Embeddings 미활성 시 BM25 단독 검색으로 fallback.

### Inbox 자동 분류

```
[Vault 이벤트: 파일 생성] → startInboxWatcher()
  → RunInboxProcessUseCase.execute()
    → VaultAccessPort.listFolder(inboxFolder)
    → OrganizeNoteUseCase.execute(path) (파일별)
      → VaultAccessPort.read(path) → 노트 내용 읽기
      → AIProviderPort.classify(content) → 분류/태그 추천
      → VaultAccessPort.write(path, updated) → 메타데이터 갱신
    → HistoryPort.append(entry)
  ← InboxProcessResult (processed, skipped, errors)
```

### Vault Maintenance (스마트 스케줄링 + TF-IDF 중복 탐지)

```
[Vault 이벤트: .md 변경] → startInboxWatcher()
  → ChangeTrackingPort.markDirty(path)

[스케줄 타이머 fire]
  → smartScheduling && dirtySet.size === 0 → skip
  → RunMaintenanceUseCase.execute()
    → findDuplicates():
      → CorpusStatsPort.loadStats() → TfIdfCorpus 복원
      → 제목 token Jaccard >= 0.4 → 후보 쌍 생성
      → 각 후보: TfIdfCorpus.cosineSimilarity(vecA, vecB) >= 0.6 → 중복 판정
      → CorpusStatsPort.saveStats()
    → ChangeTrackingPort.clearAll() + setLastScanTimestamp(now)
  ← MaintenanceResult (orphans, duplicates, broken links)
```

### Embedding Sync (백그라운드 인덱싱)

```
[plugin startup, embeddingsEnabled=true]
  → VectorStorePort.load()             → 영속 벡터 복원
  → EmbeddingPort.initialize()         → API 연결 확인
  → SyncEmbeddingsUseCase.execute()
    → ChangeTrackingPort.getDirtySet()
    → 각 dirty note: read → chunk → EmbeddingPort.embed(chunk) → VectorStorePort.upsert()
    → VectorStorePort.flush()          → JSON 영속화
```

## 뷰 간 실시간 동기화

Log, Results, OrganizeFolder 뷰는 `vaultend:history-changed` 커스텀 workspace 이벤트로 양방향 동기화된다.

- **이벤트 상수**: `HISTORY_CHANGED_EVENT` (`src/constants.ts`)
- **타입 선언**: `src/obsidian-extensions.d.ts` (`declare module 'obsidian'`으로 Workspace 인터페이스 확장)
- **발행 시점**: apply, batch apply, dismiss, batch dismiss, restore, batch restore, undo 성공 후
- **수신 동작**:
  - `MaintenanceLogView`: `scheduleRefresh()` (300ms 디바운스)로 전체 목록 갱신
  - `MaintenanceResultView`: `onHistoryChanged(undoneId?)` — undo 시 해당 항목 제거, 일반 이벤트 시 무시
  - `OrganizeFolderResultView`: `onHistoryChanged(undoneId?)` — undo 시 해당 entry를 DOM-only로 pending 복원 (전체 재렌더링 하지 않음)
- **규칙**: 새 뷰가 history를 변경하면 반드시 `workspace.trigger(HISTORY_CHANGED_EVENT)` 호출. undo 시 `undoneId` 파라미터 전달.

## 영속 파일 (`.knowledge-maintenance/`)

| 파일 | 내용 | 어댑터 |
|------|------|--------|
| `search-index.json` | BM25 검색 인덱스 | JsonSearchIndexAdapter |
| `dirty-set.json` | 변경 추적 dirty set + lastScanTimestamp | FileChangeTrackingAdapter |
| `tfidf-corpus.json` | TF-IDF 문서 빈도 통계 | FileCorpusStatsAdapter |
| `embeddings.json` | 벡터 임베딩 (base64 Float32Array) | JsonVectorStoreAdapter |

## 경계 및 계약

| 경계 | 인터페이스 | 위치 |
|------|-----------|------|
| UseCase ↔ AI | `AIProviderPort` (ABC) | `application/ports/AIProviderPort.ts` |
| UseCase ↔ Vault | `VaultAccessPort` (ABC) | `application/ports/VaultAccessPort.ts` |
| UseCase ↔ Search | `SearchIndexPort` (ABC) | `application/ports/SearchIndexPort.ts` |
| UseCase ↔ History | `HistoryPort` (ABC) | `application/ports/HistoryPort.ts` |
| UseCase ↔ Config | `ConfigPort` (ABC) | `application/ports/ConfigPort.ts` |
| UseCase ↔ Clipboard | `ClipboardPort` (ABC) | `application/ports/ClipboardPort.ts` |
| UseCase ↔ Clock | `ClockPort` (ABC) | `application/ports/ClockPort.ts` |
| UseCase ↔ Embedding | `EmbeddingPort` (ABC) | `application/ports/EmbeddingPort.ts` |
| UseCase ↔ VectorStore | `VectorStorePort` (ABC) | `application/ports/VectorStorePort.ts` |
| UseCase ↔ ChangeTracking | `ChangeTrackingPort` (ABC) | `application/ports/ChangeTrackingPort.ts` |
| UseCase ↔ CorpusStats | `CorpusStatsPort` (ABC) | `application/ports/CorpusStatsPort.ts` |

## Port → Adapter 매핑

| Port (ABC) | Adapter 구현 | 외부 의존 |
|------------|-------------|----------|
| `AIProviderPort` | `OpenAIAdapter` | OpenAI API (completion + embedding) |
| `AIProviderPort` | `GeminiAdapter` | Google Gemini API (completion + embedding) |
| `AIProviderPort` | `DynamicAIAdapter` | 런타임 provider 전환 (Strategy) |
| `VaultAccessPort` | `ObsidianVaultAdapter` | Obsidian Vault API |
| `SearchIndexPort` | `JsonSearchIndexAdapter` | 로컬 JSON 파일 |
| `HistoryPort` | `FileHistoryAdapter` | 로컬 파일 시스템 |
| `ClipboardPort` | `ObsidianClipboardAdapter` | Clipboard API |
| `ClockPort` | `SystemClockAdapter` | `Date` |
| `EmbeddingPort` | `AIEmbeddingAdapter` | `AIProviderPort.callEmbedding()` 위임 |
| `VectorStorePort` | `JsonVectorStoreAdapter` | 로컬 JSON (brute-force cosine) |
| `ChangeTrackingPort` | `FileChangeTrackingAdapter` | 로컬 JSON |
| `CorpusStatsPort` | `FileCorpusStatsAdapter` | 로컬 JSON |

## AI Provider 전략

`ConfigPort.aiProvider` 설정에 따라 런타임에 AI 어댑터를 교체한다 (Strategy 패턴).
`DynamicAIAdapter`가 Composition Root에서 캐시 + lazy switch를 담당.

| Provider | Adapter | Chat 모델 | Embedding 모델 |
|----------|---------|----------|---------------|
| `openai` | `OpenAIAdapter` | `gpt-4o` | `text-embedding-3-small` (1536-dim) |
| `gemini` | `GeminiAdapter` | 설정에 따라 | `text-embedding-004` (768-dim) |

> `AIProviderPort.callEmbedding()`은 `callCompletion`/`callClassification`과 동일한 BYOK 키를 사용한다.
> 별도 임베딩 전용 키는 불필요.

## 관련 문서

- 설계 결정 배경: [`decisions.md`](./decisions.md)
- 파일 맵: [`MAP.md`](./MAP.md)
