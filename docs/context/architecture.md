# Architecture

> 프로젝트 전체 아키텍처(레이어/흐름/경계)를 기술한다. (`docs` 브랜치에서만 편집)
> 데이터 경로·실행 모드·Repository 간 쓰기 순서가 바뀌면 갱신한다.

## 레이어 개요

Obsidian 플러그인이므로 별도 서버 없이, Plugin 클래스(`main.ts`)가 Composition Root 역할을 한다.

```
┌─────────────────────────────────────────────────┐
│ UI Layer           src/ui/                       │
│   MaintenanceResultView (중복 태그 병합 포함),     │
│   MaintenanceLogView, OrganizeFolderResultView,  │
│   OrganizeTagsView,                              │
│   PluginSettingTab                               │
├─────────────────────────────────────────────────┤
│ Composition Root   src/main.ts                   │
│   VaultendPlugin (DI 조립)                       │
├─────────────────────────────────────────────────┤
│ Application Layer  src/application/              │
│   UseCases: OrganizeNote, OrganizeFolder,        │
│             Maintenance, OrganizeTags,           │
│             ApplyMaintenanceAction, Save,         │
│             SyncEmbeddings                       │
│   Ports (ABC): AIProvider, VaultAccess,          │
│                SearchIndex, History, Config,      │
│                Clock, Embedding, VectorStore,     │
│                ChangeTracking, CorpusStats,       │
│                TagEmbeddingCache,                 │
│                NoteEmbeddingCache                 │
├─────────────────────────────────────────────────┤
│ Domain Layer       src/domain/                   │
│   Values: NoteId, NotePath, NoteTitle, ChunkText,│
│           HeadingPath, TagName, Timestamp,        │
│           Severity                               │
│   Models: Note, NoteChunk, NoteMetadata,         │
│           SaveTarget, TokenUsage, OrganizeModels, │
│           MaintenanceAction, DuplicateTagGroup,  │
│           PrivacyRule, HistoryEntry              │
│   Services: TfIdfCorpus, tokenize,              │
│             TagNormalizationService              │
│   Errors: DomainErrors                           │
├─────────────────────────────────────────────────┤
│ Adapters Layer     src/adapters/                 │
│   vault/          → ObsidianVaultAdapter         │
│   ai/             → OpenAI/Gemini/Ollama/Dynamic │
│   search/         → JsonSearchIndexAdapter       │
│   history/        → FileHistoryAdapter           │
│   clock/          → SystemClockAdapter           │
│   embedding/      → AIEmbeddingAdapter           │
│   vectorstore/    → JsonVectorStoreAdapter       │
│   tracking/       → FileChangeTrackingAdapter    │
│   corpus/         → FileCorpusStatsAdapter       │
│   tag-embedding-cache/ → FileTagEmbeddingCacheAdapter │
│   note-embedding-cache/→ FileNoteEmbeddingCacheAdapter│
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

### Organize Folder (배치 분류 — 2-pass)

```
[사용자 / 자동 감시] → OrganizeFolderUseCase.execute(folder)
  → 1회 프리페치 (배치 I/O 최적화):
    → cachedVaultTags     ← vault.listAllTags().slice(0, 200)
    → cachedAllNotes      ← vault.listNotes()
    → cachedFolders       ← 노트 경로에서 추출
    → cachedCanonicalIndex ← TagNormalizationService.buildCanonicalIndex()
    → cachedTagEmbeddings ← TagEmbeddingCachePort.getMany() → miss만 callEmbedding() → putMany()
    → noteSummaryMap      ← NoteEmbeddingCachePort.getAll()에서 기존 onelineSummary 로드

  → [Pass 1] 파일별 루프: OrganizeNoteUseCase.execute(path, autoApply, context={skipLinkSuggestion: true})
    → VaultAccessPort.read(path) → 노트 내용 읽기
    → AIProviderPort.classify(content) → 분류/태그 + onelineSummary 생성
    → TagNormalizationService.resolveToCanonical() → 태그 정규화
    → sessionTags 누적 + 신규 태그 임베딩 증분 캐싱
    → onelineSummary → noteSummaryMap에 수집 + NoteEmbeddingCachePort.put()
    → VaultAccessPort.write(path, updated) → 메타데이터 갱신
    → HistoryPort.append(entry)

  → [Pass 2] 단일 LLM 링크 선택 (vault 전체 맥락):
    → vault 노트 목록(제목+요약) 구성 (MAX_VAULT_NOTES_FOR_LINK=200)
    → PromptTemplates.linkSelectionSystemPrompt + linkSelectionUserMessage
    → AIProviderPort.callCompletion(jsonMode) → 각 대상 노트에 최대 5개 관련 노트 선택
    → parseLinkSelectionResponse → linkMap
    → autoApply 시: VaultAccessPort.write() + HistoryPort.append()
    → results에 suggestedLinks 갱신
    → NoteEmbeddingCachePort.flush() → 요약 영속화

  ← OrganizeFolderResult (processed, skipped, errors, linkSelectionTokenUsage)
```

### Organize Note (단일 노트)

```
[사용자] → OrganizeNoteUseCase.execute(path, autoApply)
  → AIProviderPort.classify(content) → 분류/태그 + onelineSummary
  → 링크 제안 (LLM-first, 임베딩 폴백):
    → computeLLMLinks(path, onelineSummary, cachedSummaries?)
      → NoteEmbeddingCachePort.getAll()에서 vault 요약 로드 (캐시 없으면 제목만 사용)
      → AIProviderPort.callCompletion(jsonMode) → 관련 노트 선택
    → LLM 결과가 0건이면 → computeEmbeddingLinks() (임베딩 코사인 폴백)
  ← OrganizeResult (tags, links, summary, onelineSummary, tokenUsage)
```

### Vault Maintenance (자동 스케줄링 + TF-IDF 중복 + 태그 중복)

```
[Vault 이벤트: .md 변경] → ChangeTrackingPort.markDirty(path)

[스케줄 타이머 fire]
  → smartScheduling → dirty set 비면 skip
  → RunMaintenanceUseCase.execute()
    → findDuplicates() (노트 중복):
      → CorpusStatsPort.loadStats() → TfIdfCorpus 복원
      → 제목 token Jaccard >= 0.4 → 후보 쌍 생성
      → 각 후보: TfIdfCorpus.cosineSimilarity(vecA, vecB) >= 0.6 → 중복 판정
      → CorpusStatsPort.saveStats()
    → findDuplicateTags() (태그 중복, 2단계):
      → Stage 1 — 문자열 정규화:
        → vault.listAllTags() → {tag, count}[]
        → TagNormalizationService.buildCanonicalIndex() → 정규화 키 그루핑
        → 2+ variants 있는 그룹 → stringDuplicates
      → Stage 2 — 임베딩 유사도 (opt-in):
        → 모든 canonical 그룹 → TagEmbeddingCachePort.getMany() → miss만 callEmbedding()
        → 쌍별 cosineSimilarity >= 0.85 → embeddingDuplicates
        → cap: MAX_EMBEDDING_TAGS = 500 (O(N²) 방지)
      → 통합: 임베딩 그룹에 흡수된 문자열 중복 그룹 dedup 후 병합
      → 각 그룹별 affectedNotes 매핑
    → ChangeTrackingPort.clearAll() + setLastScanTimestamp(now)
  ← MaintenancePlan (orphans, duplicates, brokenLinks, duplicateTags)

[병합 액션]
  → ApplyMaintenanceActionUseCase.mergeDuplicateTags(action)
    → 각 affectedNote frontmatter에서 variant → canonical 치환
    → HistoryPort.append(entry)
```

### Embedding Sync (백그라운드 인덱싱)

```
[plugin startup, embeddingsEnabled=true]
  → VectorStorePort.load()                     → 영속 벡터 복원
  → EmbeddingPort.initialize()                 → API 연결 확인
  → TagEmbeddingCachePort.load()               → 태그 임베딩 캐시 복원
    → isCompatible(provider, dim) 검사 → 불일치 시 clear()
    → setMeta({ provider, dimension })
  → SyncEmbeddingsUseCase.execute()
    → ChangeTrackingPort.getDirtySet()
    → 각 dirty note: read → chunk → EmbeddingPort.embed(chunk) → VectorStorePort.upsert()
    → VectorStorePort.flush()                  → JSON 영속화

[plugin unload]
  → TagEmbeddingCachePort.flush()              → dirty 시 JSON 영속화
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

## 영속 파일 (`.vaultend/`)

| 파일 | 내용 | 어댑터 |
|------|------|--------|
| `search-index.json` | BM25 검색 인덱스 | JsonSearchIndexAdapter |
| `dirty-set.json` | 변경 추적 dirty set + lastScanTimestamp | FileChangeTrackingAdapter |
| `tfidf-corpus.json` | TF-IDF 문서 빈도 통계 | FileCorpusStatsAdapter |
| `embeddings.json` | 벡터 임베딩 (base64 Float32Array) | JsonVectorStoreAdapter |
| `tag-embeddings.json` | 태그 임베딩 캐시 (base64 Float32Array, provider/dim 메타) | FileTagEmbeddingCacheAdapter |
| `note-embeddings.json` | 노트 임베딩 + onelineSummary 캐시 (base64 Float32Array, contentHash) | FileNoteEmbeddingCacheAdapter |

## 경계 및 계약

| 경계 | 인터페이스 | 위치 |
|------|-----------|------|
| UseCase ↔ AI | `AIProviderPort` (ABC) | `application/ports/AIProviderPort.ts` |
| UseCase ↔ Vault | `VaultAccessPort` (ABC) | `application/ports/VaultAccessPort.ts` |
| UseCase ↔ Search | `SearchIndexPort` (ABC) | `application/ports/SearchIndexPort.ts` |
| UseCase ↔ History | `HistoryPort` (ABC) | `application/ports/HistoryPort.ts` |
| UseCase ↔ Config | `ConfigPort` (ABC) | `application/ports/ConfigPort.ts` |
| UseCase ↔ Clock | `ClockPort` (ABC) | `application/ports/ClockPort.ts` |
| UseCase ↔ Embedding | `EmbeddingPort` (ABC) | `application/ports/EmbeddingPort.ts` |
| UseCase ↔ VectorStore | `VectorStorePort` (ABC) | `application/ports/VectorStorePort.ts` |
| UseCase ↔ ChangeTracking | `ChangeTrackingPort` (ABC) | `application/ports/ChangeTrackingPort.ts` |
| UseCase ↔ CorpusStats | `CorpusStatsPort` (ABC) | `application/ports/CorpusStatsPort.ts` |
| UseCase ↔ TagEmbeddingCache | `TagEmbeddingCachePort` (ABC) | `application/ports/TagEmbeddingCachePort.ts` |
| UseCase ↔ NoteEmbeddingCache | `NoteEmbeddingCachePort` (ABC) | `application/ports/NoteEmbeddingCachePort.ts` |

## Port → Adapter 매핑

| Port (ABC) | Adapter 구현 | 외부 의존 |
|------------|-------------|----------|
| `AIProviderPort` | `OpenAIAdapter` | OpenAI API (completion + embedding) |
| `AIProviderPort` | `GeminiAdapter` | Google Gemini API (completion + embedding) |
| `AIProviderPort` | `OllamaAdapter` | 로컬 Ollama API |
| `AIProviderPort` | `OpenAICompatAdapter` | OpenAI 호환 커스텀 엔드포인트 |
| `AIProviderPort` | `DynamicAIAdapter` | 런타임 provider 전환 (Strategy) |
| `VaultAccessPort` | `ObsidianVaultAdapter` | Obsidian Vault API |
| `SearchIndexPort` | `JsonSearchIndexAdapter` | 로컬 JSON 파일 |
| `HistoryPort` | `FileHistoryAdapter` | 로컬 파일 시스템 |
| `ClockPort` | `SystemClockAdapter` | `Date` |
| `EmbeddingPort` | `AIEmbeddingAdapter` | `AIProviderPort.callEmbedding()` 위임 |
| `VectorStorePort` | `JsonVectorStoreAdapter` | 로컬 JSON (brute-force cosine) |
| `ChangeTrackingPort` | `FileChangeTrackingAdapter` | 로컬 JSON |
| `CorpusStatsPort` | `FileCorpusStatsAdapter` | 로컬 JSON |
| `TagEmbeddingCachePort` | `FileTagEmbeddingCacheAdapter` | 로컬 JSON (`.vaultend/tag-embeddings.json`) |
| `NoteEmbeddingCachePort` | `FileNoteEmbeddingCacheAdapter` | 로컬 JSON (`.vaultend/note-embeddings.json`) |

## AI Provider 전략

`ConfigPort.aiProvider` 설정에 따라 런타임에 AI 어댑터를 교체한다 (Strategy 패턴).
`DynamicAIAdapter`가 Composition Root에서 캐시 + lazy switch를 담당.

| Provider | Adapter | Chat 모델 | Embedding 모델 |
|----------|---------|----------|---------------|
| `openai` | `OpenAIAdapter` | `gpt-4o` | `text-embedding-3-small` (1536-dim) |
| `gemini` | `GeminiAdapter` | 설정에 따라 | `text-embedding-004` (768-dim) |
| `ollama` | `OllamaAdapter` | 로컬 모델 | 로컬 임베딩 (설정에 따라) |
| `openai-compat` | `OpenAICompatAdapter` | 커스텀 엔드포인트 | 커스텀 (OpenAI 호환 API) |

> `AIProviderPort.callEmbedding()`은 `callCompletion`/`callClassification`과 동일한 BYOK 키를 사용한다.
> 별도 임베딩 전용 키는 불필요.

## 관련 문서

- 설계 결정 배경: [`decisions.md`](./decisions.md)
- 파일 맵: [`MAP.md`](./MAP.md)
