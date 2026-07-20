# Embedding-based Link Suggestion — 구현 명세

- **작성일**: 2026-07-21 (v2 개정)
- **상태**: Draft
- **참조**: ADR-0008 (LLM 링크 제안), 실험 데이터 (2026-07-20~21, Noluma vault 117노트)

> **v2 개정 배경**: v0.8.17까지 순수 임베딩 코사인 유사도로 링크를 제안했으나,
> `text-embedding-3-small`이 "같은 도메인" 관계를 식별하지 못하는 근본적 한계를 발견.
> v0.9.x부터 **LLM 기반 링크 제안 + 임베딩 pre-filter** 하이브리드 구조로 전환한다.

---

## 모듈 역할

OrganizeNote/OrganizeFolder 실행 시 노트 간 연관 링크를 제안한다.

**v1 (v0.8.13~0.8.17)**: 임베딩 코사인 유사도 기반 (결정론적, AI 비용 0)
**v2 (v0.9.x~)**: LLM 기반 링크 선택 + 임베딩 pre-filter (의미적 정밀도 향상)

**핵심 변경**:
1. **임베딩 → pre-filter 역할 전환** — 코사인 유사도로 후보 축소만 담당
2. **LLM 링크 선택** — vault 노트 목록(제목 + 1줄 요약)을 LLM에 전달, 관련 노트 선택
3. **1줄 요약 캐시** — Organize 호출 시 요약을 생성하여 캐시, 이후 링크 선택에 재사용

---

## 설계 근거 (실험 결과)

### v1 한계 — 임베딩 코사인 유사도의 근본적 한계

#### 실험 환경
- Vault: 117노트 (inbox 48, 분류 완료 69)
- 모델: `text-embedding-3-small` (dim 1536), 가중 합산 (title 0.2 + body 0.8)
- Threshold 범위 테스트: 0.30 ~ 0.85

#### 클러스터 커버리지 (7개 기대 클러스터, threshold별)

| Threshold | 학습/생산성 | AI/ML | Obsidian | SW Engineering | 커뮤니케이션 | 건강/생활 | 노이즈 |
|-----------|-----------|-------|---------|---------------|------------|----------|--------|
| 0.55 (v0.8.17) | 5/45 (11%) | 7/15 (47%) | 8/21 (38%) | 7/45 (16%) | 1/3 (33%) | 0/6 (0%) | 낮음 |
| 0.40 | 16/45 (36%) | 11/15 (73%) | 14/21 (67%) | 18/45 (40%) | 2/3 (67%) | 2/6 (33%) | **높음** |
| 0.30 | 29/45 (64%) | 14/15 (93%) | 18/21 (86%) | 31/45 (69%) | 3/3 (100%) | 4/6 (67%) | **매우 높음** |

#### 근본 문제: "같은 도메인" ≠ "텍스트 유사"

| 기대 연결 | 코사인 유사도 | 판정 |
|-----------|-------------|------|
| Clean Architecture ↔ 마이크로서비스 | 0.23 | **미검출** |
| 효과적인 독서법 ↔ 메타 학습 | 0.27 | **미검출** |
| Deep Work ↔ 집중력 향상 | 0.38 | threshold 0.40에서 간신히 검출 |
| 임베딩 모델 비교 ↔ 멘탈 모델 모음 | 0.42 | **노이즈** (AI ↔ 인지과학, 무관) |

> **결론**: 임베딩은 텍스트 표면 유사도를 측정한다. "같은 도메인에 속하는 서로 다른 주제"는
> 텍스트가 다르므로 유사도가 낮다. threshold를 낮추면 노이즈(무관한 노트)가 함께 포착된다.
> 이 문제는 모델이나 가중치 조정으로 해결할 수 없으며, **언어적 추론**이 필요하다.

#### 대안 분석

| 접근법 | 결과 | 기각 사유 |
|--------|------|----------|
| Title weight 0.2→0.5 | 학습 클러스터 title-only 유사도 0.30~0.35 | threshold 이하, 효과 미미 |
| 키워드/TF-IDF 부스팅 | "모델" 공유로 "임베딩 모델"↔"멘탈 모델" 오탐 악화 | 범용 단어가 교차 도메인 노이즈 유발 |
| 2단계 필터 (임베딩→키워드) | 키워드 단계에서 동일 문제 재발 | 근본 해결 안 됨 |
| Threshold slider UX | 사용자에게 트레이드오프 전가 | 어떤 값에서도 정밀도/재현율 동시 충족 불가 |

#### 실제 노트 구조 분석 (2026-07-21)

LLM 요약이 필요한 이유를 실사용 노트 분석으로 확인:

| 패턴 | 비율 | 설명 |
|------|------|------|
| heading으로 시작 (`#`) | 96% | 첫 줄이 토픽 정보를 담지 않음 |
| 의미있는 첫 100자 | 25~35% | 대부분 마크다운 서식, 템플릿 보일러플레이트 |
| 태그 보유 | ~60% | 태그 없는 노트도 상당수 |

> **결론**: 제목+첫 N글자 truncation으로는 LLM에 충분한 맥락을 줄 수 없다.
> 노트 내용을 이해한 **LLM 생성 1줄 요약**이 가장 정보 밀도가 높다.

---

## v2 아키텍처 — LLM 기반 링크 제안

### 아키텍처 변경 개요

```
v1 (현재, v0.8.17):
  전체 노트 임베딩 (캐시) → 코사인 유사도 → threshold 필터 → top 5
  ↳ 결정적, AI 비용 0, 의미적 유사도 기반
  ↳ 문제: 도메인 수준 연결 식별 불가

v2 (목표):
  [Organize 호출 시 1줄 요약 생성 → 캐시]
  → 전체 vault 노트 목록 (제목 + 캐시된 요약) → 단일 LLM 배치 호출 → 링크 선택
  ↳ LLM이 도메인 수준 관계를 추론하여 링크 선택
  ↳ 비용: 기존 80K 대비 +8.1% (+6,460 토큰)
```

### 영향 범위

| 기능 | 영향 | 설명 |
|------|------|------|
| **OrganizeNote (단일)** | 직접 | 요약 생성 + LLM 링크 선택으로 교체 |
| **OrganizeFolder (배치)** | 직접 | 요약 배치 생성 + 단일 LLM 링크 선택 호출 |
| **AI Classification** | 변경 | 출력 스키마에 `onelineSummary` 필드 추가 |
| **Note Embedding Cache** | 확장 | `onelineSummary` 필드 추가 (캐시 엔트리) |
| **Run Maintenance** | 없음 | 독립 파이프라인 (TF-IDF/Jaccard 기반) |
| **Vault Refactor** | 없음 | 독립 프롬프트 |

### 비용 분석

#### Organize Folder (48노트 배치, 117노트 vault 기준)

| 항목 | v1 토큰 | v2 추가 토큰 | 설명 |
|------|---------|-------------|------|
| 기존 Organize 호출 | ~80,000 | — | 분류 + 태그 생성 |
| 요약 출력 추가 | — | +960 | 48노트 × 20 토큰/요약 (output) |
| 링크 선택 배치 호출 (input) | — | +3,500 | 117노트 × ~30 토큰 (제목+요약) |
| 링크 선택 배치 호출 (system) | — | +500 | 시스템 프롬프트 |
| 링크 선택 배치 호출 (output) | — | +1,500 | 48 대상 × ~30 토큰 (링크 목록) |
| **합계** | ~80,000 | **+6,460** | **+8.1%** |

#### 단일 노트 (Organize Note)

| 항목 | 토큰 | 설명 |
|------|------|------|
| 기존 Organize 호출 + 요약 | +20 | onelineSummary 출력 추가 |
| 링크 선택 호출 | +4,000 | vault 목록 + 시스템 프롬프트 + 출력 |
| **합계** | **+4,020** | 단일 노트에서는 비율 더 높으나 절대량 소량 |

> **임베딩 API 비용 비교**: 기존 임베딩 호출은 유지 (pre-filter 및 태그 중복 탐지용).
> LLM 링크 선택 비용은 임베딩 비용보다 높으나, 정밀도 향상이 이를 정당화한다.

---

## 공유 타입에서 import할 타입

| 타입 | 소스 | 용도 |
|------|------|------|
| `NotePath` | `domain/values/NotePath` | 노트 경로 식별 |
| `TokenUsage` | `domain/models/TokenUsage` | API 토큰 사용량 |
| `OrganizeResult` | `domain/models/OrganizeModels` | 기존 suggestedLinks 필드 |

---

## 이 모듈에서 구현/수정할 클래스

### Domain Layer

#### services/NoteEmbeddingService.ts — `NoteEmbeddingService` (기존 유지)

임베딩 관련 순수 도메인 서비스. v2에서도 pre-filter와 태그 중복 탐지에 계속 사용.

```typescript
export class NoteEmbeddingService {
  static readonly DEFAULT_CONFIG: WeightedEmbeddingConfig;
  static readonly SIMILARITY_THRESHOLD = 0.55;   // pre-filter에 사용
  static readonly MAX_LINK_SUGGESTIONS = 5;

  static combineEmbeddings(title, body, config?): Float32Array;
  static findSimilarNotes(target, candidates, threshold?, maxResults?): LinkCandidate[];
  static computeContentHash(title, body): Promise<string>;
}
```

> v2에서 `findSimilarNotes`는 링크 제안의 최종 결과가 아닌, LLM 입력 후보 축소에 사용된다.

#### services/LinkSuggestionService.ts — `LinkSuggestionService` (신규)

LLM 기반 링크 선택을 담당하는 도메인 서비스.

```typescript
export interface NoteSummaryEntry {
  readonly notePath: NotePath;
  readonly title: string;
  readonly onelineSummary: string;
}

export interface LinkSelectionResult {
  readonly targetNotePath: NotePath;
  readonly suggestedLinks: ReadonlyArray<NotePath>;
}

export class LinkSuggestionService {
  static readonly MAX_LINK_SUGGESTIONS = 5;

  static buildLinkSelectionPrompt(
    targetNotes: ReadonlyArray<NoteSummaryEntry>,
    vaultNotes: ReadonlyArray<NoteSummaryEntry>,
    locale: 'en' | 'ko',
  ): string;

  static parseLinkSelectionResponse(
    response: string,
    vaultNoteMap: ReadonlyMap<string, NotePath>,
  ): ReadonlyArray<LinkSelectionResult>;
}
```

메서드:

- `buildLinkSelectionPrompt(targets, vault, locale)` → `string`
  - vault 전체 노트 목록을 번호 매핑으로 구성
  - 각 노트: `{번호}. {제목}: {1줄 요약}`
  - 대상 노트별로 관련 노트 번호를 선택하도록 지시
  - 최대 5개 링크, "같은 도메인·상호 보완·참조 가치" 기준 명시
  - 자기 자신 제외 규칙

- `parseLinkSelectionResponse(response, noteMap)` → `LinkSelectionResult[]`
  - LLM 응답에서 노트 번호/경로를 파싱
  - vault에 존재하는 노트만 유효 처리
  - 파싱 실패 시 빈 배열 반환 (graceful degradation)

### Application Layer

#### ports/AIProviderPort.ts — 수정

**ClassificationResponse 확장**:

```typescript
export interface ClassificationResponse {
  readonly category?: string;
  readonly suggestedTags: ReadonlyArray<string>;
  readonly summary: string;
  readonly onelineSummary?: string;   // NEW — 링크 선택용 1줄 요약
  readonly confidence: number;
  readonly tokenUsage: TokenUsage;
  readonly tagDetails?: ReadonlyArray<TagDetail>;
}
```

**LinkSelectionRequest/Response 추가**:

```typescript
export interface LinkSelectionRequest {
  readonly prompt: string;
  readonly locale?: 'en' | 'ko';
}

export interface LinkSelectionResponse {
  readonly rawText: string;
  readonly tokenUsage: TokenUsage;
}

export interface AIProviderPort {
  // 기존 메서드 유지
  callClassification(request: ClassificationRequest): Promise<ClassificationResponse>;
  callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  // NEW
  callLinkSelection(request: LinkSelectionRequest): Promise<LinkSelectionResponse>;
}
```

> `callLinkSelection`은 기존 `callClassification`과 동일한 LLM 엔드포인트를 사용하되,
> 응답 스키마가 다르므로 별도 메서드로 분리한다.

#### ports/NoteEmbeddingCachePort.ts — 수정

**NoteEmbeddingEntry 확장**:

```typescript
export interface NoteEmbeddingEntry {
  readonly notePath: NotePath;
  readonly vector: Float32Array;
  readonly contentHash: string;
  readonly onelineSummary?: string;   // NEW — LLM 생성 1줄 요약 캐시
}
```

> 기존 캐시 파일 형식과 호환 — `onelineSummary`는 optional이므로 v1 캐시를 그대로 로드 가능.
> 요약이 없는 노트는 다음 Organize 실행 시 생성된다.

**새 메서드**:

```typescript
export interface NoteEmbeddingCachePort {
  // 기존 메서드 유지
  get(notePath: NotePath): NoteEmbeddingEntry | undefined;
  put(entry: NoteEmbeddingEntry): void;
  needsUpdate(notePath: NotePath, contentHash: string): boolean;
  // ...

  // NEW
  getSummary(notePath: NotePath): string | undefined;
  getAllSummaries(): ReadonlyMap<NotePath, string>;
  needsSummary(notePath: NotePath): boolean;
}
```

#### usecases/OrganizeNoteUseCase.ts — 수정

**변경 1: AI 분류 응답에서 요약 캐시**

```typescript
// callClassification 호출 후
const classification = await this.aiProvider.callClassification({...});

// 요약 캐시 업데이트 (배치 모드에서 OrganizeFolderUseCase가 수집)
const onelineSummary = classification.onelineSummary;
```

**변경 2: 링크 제안 로직 교체**

```typescript
// v1 (제거):
// const linkResult = await this.computeEmbeddingLinks(...);

// v2 (교체):
// 배치 모드: OrganizeFolderUseCase가 전체 요약 수집 후 일괄 링크 선택
// 단일 모드: 직접 LLM 링크 선택 호출
let suggestedLinks: NotePath[] = [];
if (context?.precomputedLinks) {
  suggestedLinks = context.precomputedLinks.get(notePath) ?? [];
} else {
  suggestedLinks = await this.computeLLMLinks(notePath, onelineSummary, context);
}
```

**새 private 메서드**:

```typescript
private async computeLLMLinks(
  notePath: NotePath,
  currentSummary: string | undefined,
  context?: OrganizeContext,
): Promise<NotePath[]> {
  // 1. vault 전체 요약 목록 수집 (캐시에서)
  // 2. LinkSuggestionService.buildLinkSelectionPrompt() 호출
  // 3. this.aiProvider.callLinkSelection() 호출
  // 4. LinkSuggestionService.parseLinkSelectionResponse() 파싱
  // 5. 결과 반환
}
```

**OrganizeContext 확장**:

```typescript
export interface OrganizeContext {
  readonly sessionTags?: ReadonlyArray<string>;
  readonly cachedCanonicalIndex?: ReadonlyArray<CanonicalTagGroup>;
  readonly cachedTagEmbeddings?: Map<string, Float32Array>;
  readonly cachedVaultTags?: ReadonlyArray<{ tag: string; count: number }>;
  readonly cachedAllNotes?: ReadonlyArray<NotePath>;
  readonly cachedNoteEmbeddings?: Map<NotePath, Float32Array>;
  readonly precomputedLinks?: ReadonlyMap<NotePath, ReadonlyArray<NotePath>>;  // NEW
}
```

#### usecases/OrganizeFolderUseCase.ts — 수정

배치 모드 2-pass 구조:

```
Pass 1 — Organize 호출 (기존 + 요약 수집)
  For each unprocessed note:
    1. callClassification({..., 요약 생성 포함})
    2. 결과에서 onelineSummary 수집 → summaryMap
    3. 캐시에 요약 저장

Pass 2 — LLM 링크 선택 (단일 배치 호출)
  1. vault 전체 요약 목록 구성 (캐시 + Pass 1 수집분)
  2. LinkSuggestionService.buildLinkSelectionPrompt() 호출
  3. aiProvider.callLinkSelection() — 단일 호출
  4. 결과 파싱 → precomputedLinks Map
  5. OrganizeContext.precomputedLinks로 전달
```

```typescript
// Pass 1: 기존 Organize 루프 (요약 수집 추가)
const summaryMap = new Map<NotePath, string>();

for (const notePath of unprocessedNotes) {
  const result = await this.organizeNote.execute(notePath, autoApply, {
    ...context,
    // precomputedLinks 없음 → 링크는 Pass 2에서 처리
  });

  // 요약 수집
  if (result.onelineSummary) {
    summaryMap.set(notePath, result.onelineSummary);
    this.noteEmbeddingCache?.putSummary(notePath, result.onelineSummary);
  }
  results.push(result);
}

// Pass 2: LLM 링크 선택 (단일 배치 호출)
const vaultSummaries = this.collectVaultSummaries(cachedAllNotes, summaryMap);
const prompt = LinkSuggestionService.buildLinkSelectionPrompt(
  unprocessedNotes.map(np => vaultSummaries.get(np)).filter(Boolean),
  Array.from(vaultSummaries.values()),
  locale,
);
const linkResponse = await this.aiProvider.callLinkSelection({ prompt, locale });
const linkResults = LinkSuggestionService.parseLinkSelectionResponse(
  linkResponse.rawText, notePathMap,
);

// 결과를 각 OrganizeResult에 병합
for (const lr of linkResults) {
  const idx = results.findIndex(r => r.notePath === lr.targetNotePath);
  if (idx >= 0) {
    results[idx] = { ...results[idx], suggestedLinks: lr.suggestedLinks };
  }
}
```

> **Pass 2 분리 이유**: 요약을 모두 수집한 후 단일 LLM 호출로 링크를 선택하면
> vault 전체 맥락을 활용할 수 있고, 호출 횟수가 1회로 최소화된다.

### Adapters Layer

#### AI 어댑터 (4개) — 수정

각 어댑터에 `callLinkSelection()` 구현 추가:

| 어댑터 | 구현 방식 |
|--------|----------|
| `OpenAIAdapter` | `POST /v1/chat/completions` (기존 엔드포인트, 별도 system prompt) |
| `GeminiAdapter` | `POST /v1beta/models/{model}:generateContent` |
| `OllamaAdapter` | `POST /api/chat` |
| `OpenAICompatAdapter` | `POST /v1/chat/completions` |

> `callLinkSelection`은 기존 `callClassification`과 동일한 모델·엔드포인트를 사용하므로
> 새 API 키나 설정이 불필요하다. system prompt와 응답 파싱만 다르다.

#### AI 프롬프트 변경 — `PromptTemplates.ts`

**추가 1: Classification 출력 스키마에 `onelineSummary` 추가**

```
시스템 프롬프트에 추가:
"onelineSummary": 이 노트의 핵심 주제와 목적을 1문장(30자 이내)으로 요약.
링크 제안에 사용되므로 도메인 키워드를 포함할 것.
```

**추가 2: 링크 선택 전용 프롬프트**

```
시스템 프롬프트 (linkSelectionSystem):
당신은 Obsidian vault의 노트 연결 전문가입니다.
주어진 노트 목록에서 각 대상 노트와 관련된 노트를 선택하세요.

선택 기준:
- 같은 도메인/분야에 속하는 노트
- 상호 보완적 내용 (A를 읽은 후 B를 읽으면 이해가 깊어지는 관계)
- 참조 가치가 있는 노트 (개념, 방법론, 사례 간 연결)

제외 기준:
- 단순히 같은 단어를 공유하는 것만으로는 부족
- 서로 다른 도메인의 노트는 명확한 교차점이 있을 때만 연결

유저 프롬프트 (linkSelectionUser):
## Vault 노트 목록
{번호}. {제목}: {1줄 요약}
...

## 대상 노트
{대상 노트 번호 목록}

각 대상 노트에 대해 관련 노트를 최대 5개 선택하세요.
형식: {대상번호}: {관련번호1}, {관련번호2}, ...
```

#### adapters/note-embedding-cache/FileNoteEmbeddingCacheAdapter.ts — 수정

JSON 직렬화에 `onelineSummary` 필드 추가:

```json
{
  "meta": { "provider": "openai", "dimension": 1536, ... },
  "entries": {
    "Notes/some-note.md": {
      "vector": "base64...",
      "contentHash": "sha256...",
      "onelineSummary": "Clean Architecture의 핵심 원칙과 레이어 분리 전략"
    }
  }
}
```

---

## 클래스 관계 다이어그램

```
                 ┌────────────────────────────────┐
                 │ LinkSuggestionService (NEW)     │
                 │ (domain/services/)              │
                 │ + buildLinkSelectionPrompt()    │
                 │ + parseLinkSelectionResponse()  │
                 └────────────────────────────────┘
                              ▲ uses
┌─────────────────────────┐   │   ┌──────────────────────────┐
│ OrganizeNoteUseCase     │───┘   │ NoteEmbeddingService     │
│ (application/)          │──────▶│ (domain/services/)       │
│ + computeLLMLinks()     │       │ + combineEmbeddings()    │
│                         │       │ + findSimilarNotes()     │
│                         │       └──────────────────────────┘
│                         │
│                         │  uses  ┌──────────────────────────┐
│                         │───────▶│ AIProviderPort           │
│                         │       │ + callClassification()    │
│                         │       │ + callEmbedding()         │
│                         │       │ + callLinkSelection() NEW │
└─────────────────────────┘       └──────────────────────────┘
          ▲ called by
┌─────────┴───────────────┐  uses  ┌──────────────────────────┐
│ OrganizeFolderUseCase   │───────▶│ NoteEmbeddingCachePort   │
│ (application/)          │       │ + get/put/needsUpdate()   │
│ + Pass 1: Organize+요약│       │ + getSummary() NEW        │
│ + Pass 2: LLM 링크 선택│       │ + getAllSummaries() NEW   │
└─────────────────────────┘       └──────────────────────────┘
```

### 적용 디자인 패턴

| 패턴 | 적용 위치 | 적용 근거 |
|------|----------|----------|
| Port/Adapter | `AIProviderPort` → 4개 AI 어댑터 | LLM 제공자 격리 |
| Port/Adapter | `NoteEmbeddingCachePort` → `FileNoteEmbeddingCacheAdapter` | 영속화 인프라 격리 |
| Cache-Aside | 요약 캐시 (`onelineSummary` in `NoteEmbeddingEntry`) | 캐시 hit → skip, miss → LLM 생성 → cache |
| 2-Pass Pipeline | `OrganizeFolderUseCase` (Organize → Link Selection) | 전체 요약 수집 후 단일 LLM 호출로 비용 최적화 |

---

## 데이터 흐름

### 배치 모드 (OrganizeFolder)

```
Pass 1 — Organize + 요약 수집
  1. vault.listNotes() → allNotes
  2. noteEmbeddingCache.load()
  3. For each note: 임베딩 캐시 확인 → miss만 배치 API 호출 (기존 동일)
  4. For each unprocessed note:
     a. callClassification({..., onelineSummary 포함})
     b. classification.onelineSummary → summaryMap + 캐시 저장
     c. 태그 적용 (기존 동일)
     ※ 이 시점에서 suggestedLinks는 아직 비어있음

Pass 2 — LLM 링크 선택 (단일 호출)
  5. vault 전체 요약 목록 구성:
     - 캐시에서 기존 요약 로드
     - Pass 1에서 새로 생성된 요약 병합
  6. LinkSuggestionService.buildLinkSelectionPrompt(targets, vault, locale)
  7. aiProvider.callLinkSelection(prompt) — 1회 호출
  8. LinkSuggestionService.parseLinkSelectionResponse(response, noteMap)
  9. 결과를 각 OrganizeResult에 병합
  10. 링크 적용 (기존 wikilink 삽입 로직 동일)

Pass 3 — 영속화
  11. noteEmbeddingCache.flush() → 벡터 + 요약 + contentHash 저장
```

### 단일 모드 (OrganizeNote)

```
  1. callClassification({..., onelineSummary 포함})
  2. classification.onelineSummary 획득
  3. noteEmbeddingCache에서 vault 전체 요약 로드 (getAllSummaries())
     - 요약 없는 노트는 제목만 사용
  4. LinkSuggestionService.buildLinkSelectionPrompt(
       [현재 노트], vaultSummaries, locale
     )
  5. aiProvider.callLinkSelection(prompt) — 1회 호출
  6. parseLinkSelectionResponse → suggestedLinks
  7. 결과 반환 + 링크 적용
```

> **단일 모드 제한**: vault에 요약이 없는 노트가 많으면 (첫 Organize Folder 실행 전)
> 제목만으로 링크를 선택하므로 정밀도가 배치 모드보다 낮다.
> 첫 Organize Folder 실행 후에는 요약 캐시가 채워져 단일 모드도 정밀도가 향상된다.

---

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| 기존 AI provider 키 | Y | callClassification + callLinkSelection에 기존 provider 키 사용 |

> 새 API 키나 환경 변수 추가 없음. 기존 BYOK 키로 동작.

---

## 의존성 관계

```
Upstream (이 변경이 의존):
  ├── domain/services/NoteEmbeddingService     (combineEmbeddings, 캐시 해시)
  ├── application/ports/AIProviderPort         (callClassification, callEmbedding)
  ├── application/ports/NoteEmbeddingCachePort (요약 캐시 확장)
  └── adapters/ai/*                           (4개 AI 어댑터)

Downstream (이 변경에 의존):
  ├── application/usecases/OrganizeNoteUseCase     (링크 제안 로직 교체)
  ├── application/usecases/OrganizeFolderUseCase   (2-pass 구조 + 링크 선택)
  └── main.ts (Composition Root)                   (DI 배선 변경 없음)
```

---

## 설정 변경

### PluginSettings

```typescript
// 기존 (유지)
readonly linkSimilarityThreshold: number;   // v1 slider, deprecated in v2

// 신규
readonly linkSuggestionMode: 'embedding' | 'llm';  // default: 'llm'
```

> v2에서 `linkSimilarityThreshold` 설정은 deprecated. LLM 모드에서는 무시.
> 마이그레이션 기간 동안 `embedding` 모드로 폴백 가능.

### Settings UI

- 기존 threshold slider: `linkSuggestionMode === 'embedding'`일 때만 표시
- LLM 모드일 때는 slider 숨김 (LLM이 자체 판단)

---

## 삭제 대상 코드

| 파일 | 제거 내용 | 이유 |
|------|----------|------|
| `OrganizeNoteUseCase.ts` | `computeEmbeddingLinks()` private 메서드 | LLM 링크 선택으로 교체 |

> **유지**: `NoteEmbeddingService`, `NoteEmbeddingCachePort`, 임베딩 배치 계산 로직은
> 태그 중복 탐지·Quick Ask 시맨틱 검색에 계속 사용하므로 제거하지 않는다.
> `scoreLinkCandidates.ts`는 LLM 모드에서 불필요하나, 임베딩 폴백 모드 유지를 위해 보존.

---

## 테스트 계획

### 단위 테스트

| 테스트 대상 | 검증 항목 |
|------------|----------|
| `LinkSuggestionService.buildLinkSelectionPrompt` | 프롬프트 구조, 번호 매핑, locale 분기 |
| `LinkSuggestionService.parseLinkSelectionResponse` | 정상 파싱, 잘못된 번호 무시, 빈 응답 처리 |
| `NoteEmbeddingEntry.onelineSummary` | 캐시 직렬화/역직렬화 라운드트립 |
| AI 어댑터 `callLinkSelection` | 요청 형식, 응답 파싱, 에러 처리 |

### 통합 테스트

| 시나리오 | 검증 항목 |
|---------|----------|
| 배치 모드 첫 실행 | Pass 1 요약 수집 + Pass 2 링크 선택, 캐시에 요약 저장 |
| 배치 모드 재실행 (변경 없음) | 캐시된 요약 사용, Pass 2만 실행 |
| 배치 모드 재실행 (일부 변경) | 변경 노트만 요약 재생성, 나머지 캐시 |
| 단일 노트 실행 (요약 캐시 있음) | 캐시 요약으로 LLM 링크 선택 |
| 단일 노트 실행 (요약 캐시 없음) | 제목만으로 LLM 링크 선택 (graceful degradation) |
| LLM 응답 파싱 실패 | 빈 링크 반환, 에러 로그 |

### 골든셋 테스트

이전 세션에서 정의한 7개 클러스터로 링크 정밀도 검증:

| 클러스터 | 기대 연결 예시 | v1 결과 | v2 목표 |
|---------|--------------|---------|---------|
| 학습/생산성 | 효과적인 독서법 ↔ 메타 학습 | 미검출 (sim=0.27) | 검출 |
| SW Engineering | Clean Architecture ↔ 마이크로서비스 | 미검출 (sim=0.23) | 검출 |
| AI/ML | RAG 파이프라인 ↔ 시맨틱 검색 | 검출 (sim=0.67) | 검출 유지 |

---

## 마이그레이션 전략

### Phase 1: 인프라 확장

1. `ClassificationResponse`에 `onelineSummary` 필드 추가
2. 4개 AI 프롬프트에 onelineSummary 출력 지시 추가
3. `NoteEmbeddingEntry`에 `onelineSummary` 필드 추가 (캐시 호환)
4. `NoteEmbeddingCachePort`에 `getSummary`/`getAllSummaries`/`needsSummary` 추가
5. `FileNoteEmbeddingCacheAdapter`에 요약 직렬화/역직렬화 추가

### Phase 2: LinkSuggestionService

6. `LinkSuggestionService` 도메인 서비스 구현 (프롬프트 빌더 + 파서)
7. `AIProviderPort`에 `callLinkSelection` 추가
8. 4개 AI 어댑터에 `callLinkSelection` 구현
9. 단위 테스트

### Phase 3: UseCase 통합

10. `OrganizeNoteUseCase`에서 `computeEmbeddingLinks` → `computeLLMLinks` 교체
11. `OrganizeFolderUseCase`에 2-pass 구조 구현
12. `OrganizeContext`에 `precomputedLinks` 추가
13. Settings에 `linkSuggestionMode` 추가
14. 통합 테스트 + 골든셋 테스트

### Phase 4: 검증 + 정리

15. Obsidian 수동 검증 (배치 + 단일 모드)
16. 비용 측정 (실제 토큰 소비량 확인)
17. 임베딩 threshold slider deprecated 표시
18. 전체 빌드 + 린트 + 테스트

---

## 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|--------|--------|------|
| LLM 링크 선택 비결정성 | Medium | 같은 입력에 다른 링크가 나올 수 있음. 허용 — 매번 "최적"이 아닌 "합리적" 링크면 충분 |
| LLM 응답 파싱 실패 | Low | graceful degradation: 파싱 실패 시 빈 링크. 구조화된 응답 형식으로 파싱 안정성 확보 |
| 요약 캐시 없는 첫 실행 | Medium | 첫 Organize Folder 실행 시 요약이 없는 노트는 제목만 사용. 정밀도 제한적이나 기능은 동작 |
| 대규모 vault (500+노트) 프롬프트 크기 | Medium | 500노트 × 30토큰 = 15,000토큰. 컨텍스트 윈도우 내. 1000+ 노트 시 분할 전략 필요 (후속 개선) |
| v1→v2 마이그레이션 중 중단 | Low | `linkSuggestionMode` 설정으로 v1 폴백 가능 |
| 비용 증가에 대한 사용자 인식 | Low | +8.1%는 절대 토큰량 소량. Settings에 모드 선택 제공 |

---

## v1 코드 보존 (임베딩 모드 폴백)

| 파일 | 보존 이유 |
|------|----------|
| `NoteEmbeddingService` | 태그 중복 탐지, Quick Ask 시맨틱 검색에 사용 |
| `NoteEmbeddingCachePort` + Adapter | 임베딩 벡터 캐시 계속 사용 + 요약 캐시 확장 |
| `computeEmbeddingLinks` | `linkSuggestionMode: 'embedding'` 폴백 경로 |
| `scoreLinkCandidates.ts` | 임베딩 폴백 모드의 후보 축소에 사용 |

---

## 공개 API (모듈 README로 요약될 부분)

다른 모듈이 import할 수 있는 안정 계약:

| export | 위치 | 설명 |
|--------|------|------|
| `NoteEmbeddingService` | `domain/services/` | 가중 임베딩 합산 + 유사도 검색 |
| `LinkSuggestionService` | `domain/services/` | LLM 링크 선택 프롬프트 빌더 + 파서 (NEW) |
| `NoteEmbeddingCachePort` | `application/ports/` | 노트 임베딩 + 요약 캐시 인터페이스 |
| `NoteEmbeddingEntry` | `application/ports/` | 캐시 엔트리 타입 (onelineSummary 포함) |
| `NoteSummaryEntry` | `domain/services/` | 노트 요약 타입 (NEW) |
| `LinkSelectionResult` | `domain/services/` | 링크 선택 결과 타입 (NEW) |
| `LinkCandidate` | `domain/services/` | 임베딩 유사도 검색 결과 타입 (기존) |
| `WeightedEmbeddingConfig` | `domain/services/` | 가중치 설정 타입 (기존) |
