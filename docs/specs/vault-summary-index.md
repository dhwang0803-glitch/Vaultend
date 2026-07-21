# Vault Summary Index — 구현 명세

- **작성일**: 2026-07-21
- **상태**: Draft
- **참조**: `docs/specs/embedding-link-suggestion.md` (LLM 링크 제안 spec), PRD §Run Maintenance / §Organize

> vault 전체 노트의 LLM 생성 1줄 요약을 캐시하는 인프라.
> Organize Note/Folder/Run Maintenance 3개 기능의 공통 기반이 되어
> 링크 제안 정밀도 향상, 증분 처리, 토큰 절감을 동시에 달성한다.

---

## 모듈 역할

vault의 모든 노트에 대해 LLM 기반 1줄 요약(~30자, 키워드 밀도 높음)을 생성·캐싱하고,
이를 Organize Note/Folder의 링크 제안과 Run Maintenance의 진단에 공급한다.

**핵심 가치**:
1. **링크 제안 cold-start 해소** — 단일 노트 Organize 시 vault 전체 요약을 즉시 참조 가능
2. **증분 처리** — contentHash 비교로 변경된 노트만 재생성 (재실행 시 ~95% 토큰 절감)
3. **기능 역할 분리** — Maintenance = 진단 전용, Organize = AI 강화 (태그·링크·요약)

**트리거**: Organize Note, Organize Folder, Run Maintenance 중 어느 것이든 최초 실행 시
자동으로 vault 전체 요약 인덱싱을 수행한다 (`ensureSummaryIndex()` 게이트 패턴).

---

## 비용 분석

### 배치 요약 생성 (첫 실행, Gemini Flash 기준)

| vault 크기 | 배치 수 (20/배치) | 입력 토큰 | 출력 토큰 | 예상 비용 | 예상 시간 (5 병렬) |
|-----------|-----------------|----------|----------|----------|-------------------|
| 100 노트 | 5 | ~55,000 | ~2,000 | ~$0.004 | ~3초 |
| 500 노트 | 25 | ~275,000 | ~10,000 | ~$0.02 | ~12초 |
| 1,000 노트 | 50 | ~550,000 | ~20,000 | ~$0.04 | ~22초 |
| 5,000 노트 | 250 | ~2,750,000 | ~100,000 | ~$0.18 | ~55초 |

> 노트당 입력: ~550 토큰 (타이틀 + 본문 500자), 출력: ~20 토큰 (요약 1줄)
> 병렬 5개 기준, 배치당 ~2.2초 (API 응답 시간)

### 증분 업데이트 (재실행)

변경률 5% 가정 시 1,000노트 vault → 50노트만 재생성 → ~$0.002, ~3초

---

## 공유 타입에서 import할 타입

| 타입 | 소스 | 용도 |
|------|------|------|
| `NotePath` | `domain/values/NotePath` | 노트 경로 식별 |
| `TokenUsage` | `domain/models/TokenUsage` | API 토큰 사용량 집계 |
| `NoteEmbeddingCachePort` | `application/ports/NoteEmbeddingCachePort` | 기존 캐시 인프라 확장 |
| `NoteEmbeddingEntry` | `application/ports/NoteEmbeddingCachePort` | 캐시 엔트리 (onelineSummary 필드) |

---

## 이 모듈에서 구현/수정할 클래스

### Domain Layer

#### services/SummaryIndexService.ts — `SummaryIndexService` (신규)

배치 요약 생성의 순수 도메인 로직을 담당한다. AI 호출은 Port를 통해 위임.

```typescript
export interface SummaryBatchItem {
  readonly index: number;
  readonly notePath: NotePath;
  readonly title: string;
  readonly contentExcerpt: string;
}

export interface SummaryBatchResult {
  readonly notePath: NotePath;
  readonly onelineSummary: string;
}

export class SummaryIndexService {
  static readonly BATCH_SIZE = 20;
  static readonly CONTENT_EXCERPT_LENGTH = 500;
  static readonly MAX_CONCURRENT_BATCHES = 5;

  static buildBatchItems(
    notes: ReadonlyArray<{ notePath: NotePath; title: string; content: string }>,
  ): SummaryBatchItem[];

  static parseBatchSummaryResponse(
    response: string,
    batchItems: ReadonlyArray<SummaryBatchItem>,
  ): SummaryBatchResult[];
}
```

메서드:

- `buildBatchItems(notes)` → `SummaryBatchItem[]`
  - 각 노트에서 제목 추출, 본문 frontmatter 제거 후 500자 추출
  - 1-based 인덱스 부여
  - 빈 본문 노트는 제목만 전달

- `parseBatchSummaryResponse(response, batchItems)` → `SummaryBatchResult[]`
  - LLM 응답 JSON 파싱: `{"summaries": {"1": "요약1", "2": "요약2", ...}}`
  - code-block wrapping 처리
  - 누락된 인덱스는 건너뜀 (graceful degradation)
  - 요약이 빈 문자열이면 제목을 폴백으로 사용

### Application Layer

#### usecases/BuildSummaryIndexUseCase.ts — `BuildSummaryIndexUseCase` (신규)

vault 전체 또는 증분 요약 인덱싱을 수행하는 유스케이스.

| Input | Output | 설명 |
|-------|--------|------|
| `options?: BuildSummaryIndexOptions` | `SummaryIndexResult` | vault 요약 인덱싱 수행 |

```typescript
export interface BuildSummaryIndexOptions {
  readonly forceRebuild?: boolean;
  readonly onProgress?: (processed: number, total: number) => void;
}

export interface SummaryIndexResult {
  readonly totalNotes: number;
  readonly processedNotes: number;
  readonly skippedNotes: number;
  readonly tokenUsage: TokenUsage;
}

export class BuildSummaryIndexUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly aiProvider: AIProviderPort,
    private readonly noteEmbeddingCache: NoteEmbeddingCachePort,
    private readonly config: ConfigPort,
  ) {}

  async execute(options?: BuildSummaryIndexOptions): Promise<SummaryIndexResult>;
}
```

의존성: `VaultAccessPort`, `AIProviderPort`, `NoteEmbeddingCachePort`, `ConfigPort`

**execute() 흐름**:

```
1. vault.listNotes() → allNotes
2. noteEmbeddingCache.load()
3. 각 노트의 contentHash 계산 → needsUpdate() 비교
   - 캐시 hit + onelineSummary 있음 → skip
   - 캐시 miss 또는 contentHash 변경 또는 onelineSummary 없음 → 대상에 추가
4. 대상 노트를 BATCH_SIZE(20)씩 분할
5. MAX_CONCURRENT_BATCHES(5)개 병렬로 배치 실행:
   a. SummaryIndexService.buildBatchItems() → 프롬프트 구성
   b. PromptTemplates.batchSummarySystemPrompt(lang) + batchSummaryUserMessage(items, lang)
   c. aiProvider.callCompletion() → response
   d. SummaryIndexService.parseBatchSummaryResponse() → results
   e. 각 결과를 noteEmbeddingCache.put()으로 캐시 저장
      (기존 vector가 있으면 유지, onelineSummary만 갱신)
6. noteEmbeddingCache.flush() → 영속화
7. SummaryIndexResult 반환
```

**증분 판정 로직** (needsSummaryUpdate):

```typescript
private needsSummaryUpdate(
  notePath: NotePath,
  currentContentHash: string,
): boolean {
  const cached = this.noteEmbeddingCache.get(notePath);
  if (!cached) return true;
  if (cached.contentHash !== currentContentHash) return true;
  if (!cached.onelineSummary) return true;
  return false;
}
```

**배치 병렬 실행** (Promise.allSettled 기반):

```typescript
private async processBatchesConcurrently(
  batches: SummaryBatchItem[][],
  lang: 'en' | 'ko',
  onProgress?: (processed: number, total: number) => void,
): Promise<{ results: SummaryBatchResult[]; tokenUsage: TokenUsage }> {
  const allResults: SummaryBatchResult[] = [];
  const tokenUsages: TokenUsage[] = [];
  let processed = 0;
  const total = batches.reduce((sum, b) => sum + b.length, 0);

  for (let i = 0; i < batches.length; i += SummaryIndexService.MAX_CONCURRENT_BATCHES) {
    const chunk = batches.slice(i, i + SummaryIndexService.MAX_CONCURRENT_BATCHES);
    const settled = await Promise.allSettled(
      chunk.map(batch => this.processSingleBatch(batch, lang)),
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value.results);
        tokenUsages.push(result.value.tokenUsage);
        processed += result.value.results.length;
      }
    }
    onProgress?.(processed, total);
  }
  // ... aggregate tokenUsages
}
```

#### PromptTemplates.ts — 추가 프롬프트

```typescript
static batchSummarySystemPrompt(lang: 'en' | 'ko'): string;
static batchSummaryUserMessage(
  items: ReadonlyArray<SummaryBatchItem>,
  lang: 'en' | 'ko',
): string;
```

**batchSummarySystemPrompt** (en):
```
You are a note summarizer for an Obsidian vault.
For each note, generate a one-line summary (under 30 characters) that captures
the core topic and purpose. Include domain-specific keywords for link discovery.
Do NOT include generic words like "note", "document", "summary".

Output JSON: {"summaries": {"1": "summary1", "2": "summary2", ...}}
```

**batchSummaryUserMessage** (en):
```
[1] Title: {title}
{contentExcerpt}

[2] Title: {title}
{contentExcerpt}
...
```

#### usecases/OrganizeNoteUseCase.ts — 수정

**변경: `ensureSummaryIndex()` 게이트 추가**

```typescript
export class OrganizeNoteUseCase {
  constructor(
    // ... 기존 인자
    private readonly buildSummaryIndex?: BuildSummaryIndexUseCase,
  ) {}

  async execute(...): Promise<OrganizeResult> {
    // 첫 실행 시 요약 인덱스 자동 구축
    await this.ensureSummaryIndex();
    // ... 기존 로직
  }

  private async ensureSummaryIndex(): Promise<void> {
    if (!this.buildSummaryIndex || !this.noteEmbeddingCache) return;
    await this.noteEmbeddingCache.load();
    const allEntries = this.noteEmbeddingCache.getAll();
    const hasSummaries = [...allEntries.values()].some(e => e.onelineSummary);
    if (hasSummaries) return;  // 이미 인덱싱됨
    await this.buildSummaryIndex.execute();
  }
}
```

**변경: `computeLLMLinks` 내 vault 요약 활용 개선**

기존 `computeLLMLinks`는 캐시에 요약이 2개 미만이면 빈 배열을 반환했다.
`ensureSummaryIndex()`가 사전에 실행되므로 이 조건이 거의 발생하지 않게 된다.

#### usecases/GenerateOrganizeVaultUseCase.ts (= Organize Folder) — 수정

**변경 1: `ensureSummaryIndex()` 게이트 추가**

```typescript
async execute(plan: MaintenancePlan): Promise<OrganizeVaultPlan> {
  await this.ensureSummaryIndex();
  // ... 기존 로직
}
```

**변경 2: 증분 처리 최적화**

기존: 모든 노트에 대해 `callClassification()` 호출
변경: contentHash 비교로 캐시된 결과가 유효한 노트는 skip

```typescript
// 노트별 처리 루프에서
const cached = this.noteEmbeddingCache?.get(notePath);
const currentHash = await NoteEmbeddingService.computeContentHash(title, body);
if (cached && cached.contentHash === currentHash && cached.onelineSummary) {
  // 변경 없음 → 캐시된 요약 사용, classification 호출 생략
  // 단, 태그·링크 제안은 계속 수행 (vault context가 변경될 수 있으므로)
}
```

**변경 3: vault-wide 링크 후보 확장**

기존: Organize Folder 내 노트끼리만 링크 제안
변경: vault 전체 요약 캐시를 활용하여 폴더 외 노트도 링크 후보로 포함

#### usecases/RunMaintenanceUseCase.ts — 수정

**변경 1: `ensureSummaryIndex()` 게이트 추가**

```typescript
async execute(options?: MaintenanceScanOptions): Promise<MaintenancePlan> {
  await this.ensureSummaryIndex();
  // ... 기존 진단 로직
}
```

**변경 2: LLM 태그·링크 코드 제거** (Step 4)

Run Maintenance에서 `tryLLMLinkSuggestion()`, `tryLLMTagSuggestion()` 메서드를 제거.
대신 진단 결과 UI에 "Organize selected" 버튼을 추가하여
유저가 고아 노트/미태그 노트를 선택 → OrganizeNoteUseCase로 위임.

제거 대상:
- `tryLLMLinkSuggestion()` private 메서드
- `tryLLMTagSuggestion()` private 메서드
- `import { PromptTemplates }` (Maintenance에서 불필요)
- `import { parseLinkSelectionResponse }` (Maintenance에서 불필요)
- `import { parseTagSuggestionResponse }` (Maintenance에서 불필요)
- `import { detectContentLanguage }` (Maintenance에서 불필요)
- `MAX_VAULT_NOTES_FOR_LINK`, `TAG_BATCH_SIZE`, `TAG_CONTENT_EXCERPT_LENGTH` 상수
- `NoteEmbeddingCachePort` 생성자 인자 (단, `ensureSummaryIndex`용 BuildSummaryIndexUseCase로 교체)

유지 대상:
- `keywordTagFallback()` — AI 미설정 시 폴백
- `LinkSuggestionService.findRelatedNotes()` — TF-IDF 기반 폴백 링크 제안

**변경 3: 생성자 인자 교체**

```typescript
export class RunMaintenanceUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
    private readonly changeTracking?: ChangeTrackingPort,
    private readonly corpusStats?: CorpusStatsPort,
    private readonly aiProvider?: AIProviderPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
    private readonly buildSummaryIndex?: BuildSummaryIndexUseCase,  // 변경: NoteEmbeddingCachePort → BuildSummaryIndexUseCase
  ) {}
}
```

### Adapters Layer

#### adapters/note-embedding-cache/FileNoteEmbeddingCacheAdapter.ts — 수정

기존 `onelineSummary` 필드 직렬화는 이미 구현됨 (embedding-link-suggestion spec Phase 1).
추가 변경 없음.

### UI Layer

#### ui/MaintenanceResultView.ts — 수정 (Step 4)

**변경: "Organize selected" 버튼 추가**

고아 노트 섹션과 미태그 노트 섹션에 체크박스 + "Organize selected" 버튼을 추가.
유저가 노트를 선택하고 버튼을 클릭하면 `OrganizeNoteUseCase.execute()`를 순차 호출.

```typescript
// 고아 노트 섹션
private renderOrphanSection(container: HTMLElement, orphans: OrphanNoteEntry[]): void {
  // ... 기존 목록 렌더링
  // 체크박스 추가: 각 orphan 항목에 선택 가능
  // "Organize selected" 버튼: 선택된 노트들에 대해 OrganizeNoteUseCase 실행
}

// 미태그 노트 섹션
private renderUntaggedSection(container: HTMLElement, untagged: NotePath[]): void {
  // ... 기존 목록 렌더링
  // 동일하게 체크박스 + "Organize selected" 버튼
}
```

---

## 클래스 관계 다이어그램

```
┌───────────────────────────────────┐
│ SummaryIndexService (NEW)         │
│ (domain/services/)                │
│ + BATCH_SIZE = 20                 │
│ + CONTENT_EXCERPT_LENGTH = 500    │
│ + MAX_CONCURRENT_BATCHES = 5      │
│ + buildBatchItems()               │
│ + parseBatchSummaryResponse()     │
└───────────────────────────────────┘
                ▲ uses
┌───────────────┴───────────────────────────┐
│ BuildSummaryIndexUseCase (NEW)            │
│ (application/usecases/)                   │
│ + execute(options?)                       │
│ - needsSummaryUpdate()                    │
│ - processBatchesConcurrently()            │
│ - processSingleBatch()                    │
└───────────────────────────────────────────┘
      │ uses                │ uses              │ uses
      ▼                     ▼                   ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ VaultAccess  │  │ AIProviderPort   │  │ NoteEmbeddingCache │
│ Port         │  │ + callCompletion │  │ Port               │
│ + listNotes  │  │                  │  │ + get/put/flush    │
│ + readNote   │  │                  │  │ + needsUpdate      │
└──────────────┘  └──────────────────┘  └────────────────────┘

┌───────────────────────────────────┐
│ OrganizeNoteUseCase               │
│ (application/usecases/)           │
│ + execute()                       │
│ - ensureSummaryIndex() NEW        │
│ - computeLLMLinks() (기존)         │
│                                   │
│ ─ ─ ─ ▶ BuildSummaryIndexUseCase  │  (optional 의존)
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ GenerateOrganizeVaultUseCase      │
│ (application/usecases/)           │
│ + execute()                       │
│ - ensureSummaryIndex() NEW        │
│                                   │
│ ─ ─ ─ ▶ BuildSummaryIndexUseCase  │  (optional 의존)
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ RunMaintenanceUseCase             │
│ (application/usecases/)           │
│ + execute()                       │
│ - ensureSummaryIndex() NEW        │
│ - findOrphanNotes() (TF-IDF 폴백) │
│ - suggestMissingTags() (키워드)    │
│                                   │
│ ─ ─ ─ ▶ BuildSummaryIndexUseCase  │  (optional 의존)
└───────────────────────────────────┘
```

### 적용 디자인 패턴

| 패턴 | 적용 위치 | 적용 근거 |
|------|----------|----------|
| Port/Adapter | `NoteEmbeddingCachePort` → `FileNoteEmbeddingCacheAdapter` | 영속화 인프라 격리 (기존) |
| Cache-Aside | `BuildSummaryIndexUseCase` | 캐시 hit → skip, miss → LLM 생성 → cache |
| Gate/Guard | `ensureSummaryIndex()` | 3개 UseCase 진입점에서 캐시 초기화 보장 |
| Batch Pipeline | `processBatchesConcurrently()` | 대량 노트를 배치 분할 + 병렬 처리 |

---

## 데이터 흐름

### 첫 실행 (Full Index Build)

```
유저: Organize Note / Organize Folder / Run Maintenance 중 하나 실행
  │
  ▼
ensureSummaryIndex()
  │
  ├── noteEmbeddingCache.load()
  ├── getAll() → 요약이 하나도 없음
  │
  ▼
BuildSummaryIndexUseCase.execute()
  │
  ├── vault.listNotes() → 1000개
  ├── 각 노트 readNote() → contentHash 계산
  ├── needsSummaryUpdate() → 1000개 전부 대상
  │
  ├── 배치 분할: 50 배치 × 20 노트
  │
  ├── 병렬 처리 (5 배치 동시):
  │   ├── callCompletion(batchSummaryPrompt) → JSON 응답
  │   ├── parseBatchSummaryResponse() → SummaryBatchResult[]
  │   └── noteEmbeddingCache.put() (vector 없으면 zero vector 또는 기존 유지)
  │
  ├── noteEmbeddingCache.flush() → 디스크 저장
  │
  ▼
원래 기능 실행 (Organize / Maintenance)
  └── vault 전체 요약 캐시 활용 가능
```

### 증분 실행 (Incremental Update)

```
ensureSummaryIndex()
  │
  ├── noteEmbeddingCache.load()
  ├── getAll() → 요약 있음 (hasSummaries = true)
  └── return (skip)  ← 게이트 통과

원래 기능 실행 시 개별 노트 처리:
  ├── 변경된 노트 → callClassification() 시 onelineSummary 갱신
  └── 미변경 노트 → 캐시된 요약 사용
```

### Organize Note 단일 실행 (요약 캐시 활용)

```
OrganizeNoteUseCase.execute(notePath)
  │
  ├── ensureSummaryIndex() → 캐시 있으면 즉시 통과
  │
  ├── callClassification() → onelineSummary 획득
  │
  ├── computeLLMLinks(notePath, summary)
  │   ├── noteEmbeddingCache.getAll() → vault 전체 요약 로드
  │   ├── summaries.size ≥ 2 ✓ (캐시 있으므로)
  │   ├── buildLinkSelectionPrompt(target, vaultSummaries, locale)
  │   ├── callCompletion() → 링크 선택
  │   └── parseLinkSelectionResponse() → suggestedLinks
  │
  └── 결과 반환 (태그 + 링크 + 요약)
```

---

## NoteEmbeddingEntry 요약 전용 저장 전략

요약 인덱싱은 임베딩 없이 요약만 생성한다. 기존 `NoteEmbeddingEntry`의 `vector` 필드는
`Float32Array`이므로 요약 전용 엔트리에는 빈 벡터(길이 0)를 사용한다.

```typescript
// 요약만 저장할 때
noteEmbeddingCache.put({
  notePath,
  vector: new Float32Array(0),  // 빈 벡터 — 임베딩 미생성 표시
  contentHash,
  onelineSummary,
});
```

기존 임베딩 엔트리가 있는 경우: vector를 유지하고 onelineSummary만 갱신.

```typescript
const existing = noteEmbeddingCache.get(notePath);
noteEmbeddingCache.put({
  notePath,
  vector: existing?.vector ?? new Float32Array(0),
  contentHash,
  onelineSummary,
});
```

> `vector.length === 0`이면 임베딩 미생성 상태. `NoteEmbeddingService.findSimilarNotes()`에서
> 자연스럽게 제외된다 (코사인 유사도 계산 불가).

---

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| 기존 AI provider 키 | Y | callCompletion에 기존 BYOK 키 사용 |

> 새 API 키나 환경 변수 추가 없음.

---

## 의존성 관계

```
Upstream (이 변경이 의존):
  ├── domain/services/SummaryIndexService      (배치 빌드 + 파싱)
  ├── domain/services/NoteEmbeddingService     (contentHash 계산)
  ├── application/ports/VaultAccessPort        (노트 목록 + 읽기)
  ├── application/ports/AIProviderPort         (callCompletion)
  ├── application/ports/NoteEmbeddingCachePort (요약 캐시 저장/조회)
  └── application/ports/ConfigPort             (설정 조회)

Downstream (이 변경에 의존):
  ├── application/usecases/OrganizeNoteUseCase          (ensureSummaryIndex 호출)
  ├── application/usecases/GenerateOrganizeVaultUseCase (ensureSummaryIndex 호출)
  ├── application/usecases/RunMaintenanceUseCase        (ensureSummaryIndex 호출)
  └── main.ts (Composition Root)                        (DI 배선)
```

---

## 디렉토리 구조 (변경/추가 파일)

```
src/
├── domain/
│   └── services/
│       └── SummaryIndexService.ts              NEW
├── application/
│   ├── usecases/
│   │   ├── BuildSummaryIndexUseCase.ts         NEW
│   │   ├── OrganizeNoteUseCase.ts              MODIFY (ensureSummaryIndex 추가)
│   │   ├── GenerateOrganizeVaultUseCase.ts     MODIFY (ensureSummaryIndex 추가)
│   │   └── RunMaintenanceUseCase.ts            MODIFY (LLM 코드 제거 + ensureSummaryIndex)
│   ├── PromptTemplates.ts                      MODIFY (배치 요약 프롬프트 추가)
│   └── utils/
│       ├── parseBatchSummaryResponse.ts        NEW
│       └── __tests__/
│           └── parseBatchSummaryResponse.test.ts NEW
├── ui/
│   └── MaintenanceResultView.ts                MODIFY (Organize selected 버튼)
├── i18n/
│   └── locales/
│       ├── en.ts                               MODIFY (Organize selected i18n)
│       └── ko.ts                               MODIFY (Organize selected i18n)
└── main.ts                                     MODIFY (DI 배선)
```

---

## 구현 순서 (4 Steps)

### Step 1: 요약 캐시 인프라 구축

1. `SummaryIndexService` 도메인 서비스 구현
2. `parseBatchSummaryResponse` 유틸 + 단위 테스트
3. `PromptTemplates`에 `batchSummarySystemPrompt/UserMessage` 추가
4. `BuildSummaryIndexUseCase` 구현
5. `BuildSummaryIndexUseCase` 단위 테스트

### Step 2: 배치 요약 인덱싱 연동

6. `main.ts`에 DI 배선 (`BuildSummaryIndexUseCase` 생성 + 전달)
7. 3개 UseCase에 `ensureSummaryIndex()` 게이트 추가
8. 통합 테스트 (첫 실행 시 인덱싱 → 재실행 시 skip)

### Step 3: Organize Note/Folder 최적화

9. `OrganizeNoteUseCase` — `computeLLMLinks`가 캐시 요약을 안정적으로 활용하는지 확인
10. `GenerateOrganizeVaultUseCase` — 증분 처리 (변경 없는 노트 skip)
11. vault-wide 링크 후보 확장 (폴더 외 노트도 포함)

### Step 4: Maintenance LLM 코드 제거 + Organize selected

12. `RunMaintenanceUseCase`에서 `tryLLMLinkSuggestion()`, `tryLLMTagSuggestion()` 제거
13. 관련 import 정리 (`PromptTemplates`, `parseLinkSelectionResponse`, `parseTagSuggestionResponse`, `detectContentLanguage`)
14. `parseTagSuggestionResponse.ts` 파일 삭제 (Maintenance 전용이었으므로)
15. `PromptTemplates`에서 `maintenanceTagSuggestionSystemPrompt/UserMessage` 제거
16. `MaintenanceResultView`에 체크박스 + "Organize selected" 버튼 추가
17. i18n 키 추가 (`organizeSelected`, 관련 메시지)
18. 토큰 사용량 표시 유지 (ensureSummaryIndex의 토큰만 표시)

---

## 테스트 계획

### 단위 테스트

| 테스트 대상 | 검증 항목 |
|------------|----------|
| `SummaryIndexService.buildBatchItems` | 배치 구성, 인덱스 부여, 본문 추출, 빈 노트 처리 |
| `SummaryIndexService.parseBatchSummaryResponse` | JSON 파싱, code-block, 누락 인덱스, 빈 요약 폴백 |
| `parseBatchSummaryResponse` (유틸) | 정상/빈응답/파싱실패/code-block 케이스 |
| `BuildSummaryIndexUseCase.needsSummaryUpdate` | 캐시 miss, hash 변경, 요약 없음, 변경 없음 |

### 통합 테스트

| 시나리오 | 검증 항목 |
|---------|----------|
| 첫 실행 (빈 캐시) | 전체 노트 인덱싱, 캐시 저장, progress 콜백 |
| 재실행 (캐시 있음, 변경 없음) | 0개 처리, 즉시 반환 |
| 재실행 (일부 노트 변경) | 변경분만 재생성, 나머지 캐시 유지 |
| forceRebuild | 전체 재생성 |
| AI 미설정 시 | ensureSummaryIndex skip, 기존 로직 동작 |
| LLM 응답 파싱 실패 | graceful degradation, 해당 노트만 skip |

### 게이트 테스트

| 시나리오 | 검증 항목 |
|---------|----------|
| OrganizeNote 첫 실행 | ensureSummaryIndex → BuildSummaryIndex 실행 |
| OrganizeNote 재실행 | ensureSummaryIndex → skip (이미 인덱싱됨) |
| RunMaintenance 첫 실행 | ensureSummaryIndex → BuildSummaryIndex 실행 |
| AI 미설정 | ensureSummaryIndex → skip (buildSummaryIndex 없음) |

---

## 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|--------|--------|------|
| 첫 실행 시 대기 시간 (5K 노트 ~55초) | Medium | progress UI 표시 + 비용 사전 안내 |
| LLM 요약 품질 편차 | Low | 30자 제한 + 도메인 키워드 강조 프롬프트. 품질 낮으면 다음 실행 시 갱신 가능 |
| 빈 벡터(Float32Array(0)) 사이드이펙트 | Low | findSimilarNotes에서 자연 제외. 직렬화/역직렬화 테스트로 확인 |
| 캐시 파일 크기 증가 | Low | 요약은 노트당 ~100B. 5K 노트 = ~500KB 추가 (기존 벡터 캐시 대비 미미) |
| 배치 LLM 호출 부분 실패 | Low | Promise.allSettled로 부분 성공 허용. 실패 노트는 다음 실행 시 재시도 |
| ensureSummaryIndex 중복 실행 | Low | 캐시 load 후 hasSummaries 체크가 매우 빠름 (~ms). 동시 실행 시에도 멱등 |

---

## 삭제 대상 코드 (Step 4)

| 파일 | 제거 내용 | 이유 |
|------|----------|------|
| `RunMaintenanceUseCase.ts` | `tryLLMLinkSuggestion()` | Organize selected로 대체 |
| `RunMaintenanceUseCase.ts` | `tryLLMTagSuggestion()` | Organize selected로 대체 |
| `RunMaintenanceUseCase.ts` | LLM 관련 import 6개 | 더 이상 Maintenance에서 불필요 |
| `RunMaintenanceUseCase.ts` | `MAX_VAULT_NOTES_FOR_LINK`, `TAG_BATCH_SIZE`, `TAG_CONTENT_EXCERPT_LENGTH` 상수 | LLM 코드와 함께 제거 |
| `parseTagSuggestionResponse.ts` | 파일 전체 | Maintenance 전용 파서 (Organize에서는 미사용) |
| `parseTagSuggestionResponse.test.ts` | 파일 전체 | 파서와 함께 제거 |
| `PromptTemplates.ts` | `maintenanceTagSuggestionSystemPrompt/UserMessage` | Maintenance 전용 프롬프트 |
| `i18n/en.ts`, `ko.ts` | `maintenance.tokenTotal*` 키 | tokenUsage 표시 로직 변경에 따라 교체 |

---

## 공개 API (모듈 README로 요약될 부분)

| export | 위치 | 설명 |
|--------|------|------|
| `SummaryIndexService` | `domain/services/` | 배치 요약 생성 도메인 서비스 (NEW) |
| `SummaryBatchItem` | `domain/services/` | 배치 입력 타입 (NEW) |
| `SummaryBatchResult` | `domain/services/` | 배치 결과 타입 (NEW) |
| `BuildSummaryIndexUseCase` | `application/usecases/` | vault 요약 인덱싱 유스케이스 (NEW) |
| `BuildSummaryIndexOptions` | `application/usecases/` | 인덱싱 옵션 (NEW) |
| `SummaryIndexResult` | `application/usecases/` | 인덱싱 결과 (NEW) |
