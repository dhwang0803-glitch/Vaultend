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
│   OrganizeVaultView (Vault PR + Refactor),       │
│   RefactorGoalModal,                             │
│   PluginSettingTab                               │
├─────────────────────────────────────────────────┤
│ Composition Root   src/main.ts                   │
│   VaultendPlugin (DI 조립)                       │
├─────────────────────────────────────────────────┤
│ Application Layer  src/application/              │
│   UseCases: OrganizeNote, OrganizeFolder,        │
│             Maintenance,                         │
│             ApplyMaintenanceAction, Save,         │
│             SyncEmbeddings,                      │
│             GenerateOrganizeVault,               │
│             ApplyOrganizeVault,                   │
│             RollbackOrganizeVault,                │
│             GenerateRefactorPlan,                 │
│             EstimateRefactorCost,                 │
│             RecordPreference                     │
│   Services: PreferencePromptEnricher,            │
│             RefactorPromptTemplates              │
│   Ports (ABC): AIProvider, VaultAccess,          │
│                SearchIndex, History, Config,      │
│                Clock, Embedding, VectorStore,     │
│                ChangeTracking, CorpusStats,       │
│                License, OrganizeVault,            │
│                Preference, TagEmbeddingCache,     │
│                NoteEmbeddingCache                 │
├─────────────────────────────────────────────────┤
│ Domain Layer       src/domain/                   │
│   Values: NoteId, NotePath, NoteTitle, ChunkText,│
│           HeadingPath, TagName, Timestamp,        │
│           Severity                               │
│   Models: Note, NoteChunk, NoteMetadata,         │
│           SaveTarget, TokenUsage, OrganizeModels, │
│           MaintenanceAction, DuplicateTagGroup,  │
│           PrivacyRule, HistoryEntry,             │
│           License (LicenseTier, ProFeatureId,    │
│                    LicenseStatus, PRO_FEATURES), │
│           OrganizeVaultPlan, RefactorModels,      │
│           PreferenceModels (Signal, Rule, RuleSet)│
│   Services: TfIdfCorpus, tokenize,              │
│             TagNormalizationService,             │
│             PreferenceExtractor                  │
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
│   license/        → LocalLicenseAdapter          │
│   organize-vault/ → FileOrganizeVaultAdapter     │
│   preference/     → FilePreferenceAdapter        │
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
  → LicensePort.canUseFeature('auto-maintenance') → false → 인터벌 해제
  → smartScheduling → dirty set 비면 skip (auto-maintenance의 하위 동작)
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

### OrganizeVault — Vault PR (AI 기반 inbox 정리 + 리팩터)

```
[사용자] → OrganizeVaultView (탭 뷰, Organize/Refactor 모드 전환)

[Organize 모드]
  → GenerateOrganizeVaultUseCase.execute(folder, options)
    → VaultAccessPort.listNotes(folder) → 대상 노트 수집
    → 노트별: VaultAccessPort.read() → 내용 읽기
    → PreferencePort?.getPreferenceContext('organize') → 학습된 선호 프롬프트
    → AIProviderPort.callCompletion(systemPrompt + preference, noteContent)
      → 분류: move / tag / link / merge / skip
    → OrganizeVaultPlan 생성 (proposals 배열)
    → OrganizeVaultPort.save(plan) → .vaultend/organize-vault-plan.json
  ← OrganizeVaultPlan

[Refactor 모드]
  → GenerateRefactorPlanUseCase.execute(mode, goal?)
    → mode: restructure / tag-cleanup / link-enrichment / fleeting-process
    → vault 전체 스캔 → 구조 분석
    → PreferencePort?.getPreferenceContext('refactor') → 학습된 선호
    → AIProviderPort.callCompletion(modePrompt + preference, vaultContext)
    → OrganizeVaultPlan 생성
    → OrganizeVaultPort.save(plan)
  ← OrganizeVaultPlan

[제안 승인/거절 — 학습 연동]
  → OrganizeVaultView.setProposalStatus(proposalId, 'approved'|'rejected')
    → RecordPreferenceUseCase.execute(proposal, action)  ← fire-and-forget
    → OrganizeVaultPort.updateProposalStatus(planId, proposalId, status)

[Apply (일괄 적용)]
  → ApplyOrganizeVaultUseCase.execute(planId)
    → OrganizeVaultPort.load(planId) → approved proposals 필터
    → 각 proposal: VaultAccessPort.write() → 실제 파일 변경
    → OrganizeVaultPort.markApplied(planId)
    → HistoryPort.append(entry)

[Rollback]
  → RollbackOrganizeVaultUseCase.execute(planId)
    → OrganizeVaultPort.load(planId) → applied proposals
    → 각 proposal: VaultAccessPort.write() → 원본 복원
    → HistoryPort.append(entry)
```

### Preference Learning (사용자 패턴 학습)

```
[신호 수집 — approve/reject 시]
  → RecordPreferenceUseCase.execute(proposal, action)
    → PreferenceExtractor.extractSignal(proposal, action, timestamp)
      → signalType 추론: folder-routing / tag-mapping / exclusion / link-suggestion / property-template
      → metadata 제거 (preferences.json 비대화 방지)
    → PreferencePort.recordSignal(signal)  ← write 직렬화 뮤텍스 보호
      → load → trimSignals(200 FIFO) → deriveRules(threshold=3) → buildFewShotExamples(10)
      → save(updated)

[규칙 도출]
  → PreferenceExtractor.deriveRules(signals, threshold=3)
    → 동일 (signalType + pattern + action) 그루핑
    → hitCount ≥ threshold → PreferenceRule 생성 (source: 'learned')

[프롬프트 주입 — AI 호출 시]
  → GenerateOrganizeVaultUseCase / GenerateRefactorPlanUseCase
    → PreferencePort.getPreferenceContext(mode)
      → PreferencePromptEnricher.buildPreferenceBlock(rules, fewShots, mode)
        → "--- User Preferences ---\nRules:\n...\nExamples:\n..." 형태
        → 500토큰 초과 시 rule 수 자동 제한
    → systemPrompt += preferenceContext

[수동 규칙 관리 — Settings UI]
  → FilePreferenceAdapter.addManualRule(ruleType, pattern, action)  ← 직렬화 보호
  → FilePreferenceAdapter.deleteRule(ruleId)
    → learned 규칙 삭제 시 해당 signals도 함께 제거 (재생성 방지)
  → FilePreferenceAdapter.resetAll()
```

> **직렬화 보호**: `FilePreferenceAdapter`의 모든 write 연산(`recordSignal`, `deleteRule`, `addManualRule`)은 Promise-chaining 뮤텍스(`serialized()`)로 보호된다. 사용자가 빠르게 반복 클릭해도 read-modify-write 경쟁 조건이 발생하지 않는다.

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
| `organize-vault-plan.json` | OrganizeVault 실행 계획 (proposals + 상태) | FileOrganizeVaultAdapter |
| `preferences.json` | 학습된 선호 규칙 + 신호 로그 + few-shot 예제 | FilePreferenceAdapter |
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
| UI/main.ts ↔ License | `LicensePort` (ABC) | `application/ports/LicensePort.ts` |
| UseCase ↔ OrganizeVault | `OrganizeVaultPort` (ABC) | `application/ports/OrganizeVaultPort.ts` |
| UseCase ↔ Preference | `PreferencePort` (ABC) | `application/ports/PreferencePort.ts` |
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
| `LicensePort` | `LocalLicenseAdapter` | 로컬 체크섬 검증 (향후 Ed25519/서버 전환) |
| `OrganizeVaultPort` | `FileOrganizeVaultAdapter` | 로컬 JSON (`.vaultend/organize-vault-plan.json`) |
| `PreferencePort` | `FilePreferenceAdapter` | 로컬 JSON (`.vaultend/preferences.json`) |
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

## Free/Pro 게이팅

게이팅은 **진입점(main.ts 커맨드 핸들러 + UI View)에서만** 수행한다. UseCase/Domain 레이어는 라이선스를 모른다.

| Pro 기능 | 게이팅 위치 | ProFeatureId |
|----------|------------|-------------|
| 폴더 일괄 Organize | `main.ts` 커맨드/컨텍스트 메뉴, `OrganizeFolderResultView.triggerScan()` | `organize-folder` |
| 자동 Maintenance (Smart Scheduling 포함) | `main.ts` `scheduleMaintenanceIfEnabled()` (생성 시 + 매 tick) | `auto-maintenance` |
| OrganizeVault (Vault PR) | `OrganizeVaultView` | `organize-vault` |
| Vault Refactor | `OrganizeVaultView` (Refactor 탭) | `vault-refactor` |

- **LicensePort**: `getStatus()`, `activate(key)`, `deactivate()`, `canUseFeature(id)`
- **LocalLicenseAdapter**: 로컬 체크섬 검증 (`VE-XXXX-XXXX-XXXX-XXXX` 형식). Phase 3에서 Ed25519/서버 검증으로 교체 예정.
- **Grace Period**: 기존 사용자에게 14일 유예. `PluginSettings.proGraceDeadline`에 영속화.

## 관련 문서

- 설계 결정 배경: [`decisions.md`](./decisions.md)
- 파일 맵: [`MAP.md`](./MAP.md)
