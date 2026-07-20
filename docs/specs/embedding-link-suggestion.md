# Embedding-based Link Suggestion — 구현 명세

- **작성일**: 2026-07-21
- **상태**: Draft
- **참조**: 실험 데이터 (2026-07-20, Noluma vault 97노트), `docs/specs/plan/` 세션 기록

> AI completion 기반 링크 제안을 **임베딩 코사인 유사도** 기반으로 교체한다.
> 태그는 AI가 생성하고(generative), 링크는 임베딩이 처리한다(deterministic).

---

## 모듈 역할

OrganizeNote/OrganizeFolder 실행 시 노트 간 연관 링크를 제안하는 기능을 AI completion 호출에서 임베딩 코사인 유사도 비교로 전환한다.

**핵심 목적**:
1. **결정론적 결과** — 같은 콘텐츠에 같은 링크를 항상 제안 (멱등성 보장)
2. **AI 비용 0** — 초기 임베딩 계산 후 추가 API 호출 없음
3. **누락 방지** — AI가 놓치는 의미적 연결을 코사인 유사도로 포착

---

## 설계 근거 (실험 결과)

### 실험 환경
- Vault: 97노트 (inbox 48, 분류 완료 49)
- 모델: `gemini-embedding-001` (dim 3072)
- 비교 대상: AI 링크 제안 vs 임베딩 코사인 유사도

### 주요 발견

| 항목 | 결과 |
|------|------|
| 자연 클러스터 | 5개 (Obsidian/PKM 85-92%, AI/ML 81-88%, Productivity 82-87%, Learning 83-89%, Dev 80-88%) |
| AI 누락 연결 | RAG↔시맨틱검색 86.5%, 임베딩모델↔벡터DB 88.2%, Deep Work↔집중력 86.8% |
| 최적 임계값 | **85%** — 강한 연결을 포착하면서 노이즈 최소화 |
| 80% 임계값 | 한국어 기술 문서의 문체 유사성으로 인한 노이즈 증가 |
| 97.5% 오탐 | 제목 단어 공유에 의한 과매칭 (예: "테스트 전략" ↔ "테스트용 시맨틱") |

### 제목/본문 분리 임베딩

단일 임베딩(`제목\n\n본문`)은 짧은 제목의 키워드가 과대 가중되어 오탐이 발생한다.

**해결**: 제목과 본문을 별도 임베딩 후 가중 합산.

```
final_embedding = 0.2 × title_embedding + 0.8 × body_embedding
```

| 가중치 | 근거 |
|--------|------|
| 제목 0.2 | 제목은 핵심 토픽 식별에 유용하나 1-5단어로 노이즈 기여가 큼 |
| 본문 0.8 | 본문이 실제 의미적 깊이를 담음. 제목 오매칭(97.5% 사례) 방지 |

> 근거: Sentence-BERT 계열 연구에서 제목(query) vs 본문(passage) 비대칭 가중이 짧은 텍스트 오매칭을 완화하는 것으로 보고됨. 0.2/0.8은 실험에서 검증된 시작점이며, 설정화 가능하게 구현.

---

## 아키텍처 변경 개요

```
Before (AI 기반):
  scoreLinkCandidates(토큰 매칭) → top 50 → AI callClassification → relatedNotes 파싱
  ↳ 비결정적, AI 비용 발생, 누락 가능

After (임베딩 기반):
  전체 노트 임베딩 (캐시) → 코사인 유사도 계산 → threshold 필터 → top 5
  ↳ 결정적, 초기 임베딩 후 비용 0, 의미적 유사도 기반
```

### 영향 범위

| 기능 | 영향 | 설명 |
|------|------|------|
| **OrganizeNote (단일)** | 직접 | 링크 제안 로직 교체 |
| **OrganizeFolder (배치)** | 직접 | 노트 임베딩 배치 캐시 추가 |
| **Run Maintenance** | 없음 | 독립 파이프라인 (TF-IDF/Jaccard 기반) |
| **Vault Refactor** | 없음 | 독립 프롬프트 (RefactorPromptTemplates) |
| **AI Classification** | 간접 | availableNotes 파라미터 제거 → 프롬프트 축소 |

---

## 공유 타입에서 import할 타입

| 타입 | 소스 | 용도 |
|------|------|------|
| `NotePath` | `domain/values/NotePath` | 노트 경로 식별 |
| `TokenUsage` | `domain/models/TokenUsage` | 임베딩 API 토큰 사용량 |
| `OrganizeResult` | `domain/models/OrganizeModels` | 기존 suggestedLinks 필드 |

---

## 이 모듈에서 구현/수정할 클래스

### Domain Layer

#### services/NoteEmbeddingService.ts — `NoteEmbeddingService`

노트 콘텐츠에서 가중 임베딩 벡터를 생성하고 코사인 유사도 기반으로 관련 노트를 검색하는 순수 도메인 서비스.

```typescript
export interface WeightedEmbeddingConfig {
  readonly titleWeight: number;   // default 0.2
  readonly bodyWeight: number;    // default 0.8
}

export interface LinkCandidate {
  readonly notePath: NotePath;
  readonly similarity: number;
}

export class NoteEmbeddingService {
  static readonly DEFAULT_CONFIG: WeightedEmbeddingConfig = {
    titleWeight: 0.2,
    bodyWeight: 0.8,
  };

  static readonly SIMILARITY_THRESHOLD = 0.85;
  static readonly MAX_LINK_SUGGESTIONS = 5;

  static combineEmbeddings(
    titleEmbedding: Float32Array,
    bodyEmbedding: Float32Array,
    config?: WeightedEmbeddingConfig,
  ): Float32Array;

  static findSimilarNotes(
    targetEmbedding: Float32Array,
    candidateEmbeddings: ReadonlyMap<NotePath, Float32Array>,
    threshold?: number,
    maxResults?: number,
  ): ReadonlyArray<LinkCandidate>;
}
```

메서드:

- `combineEmbeddings(title, body, config?)` → `Float32Array`
  - `result[i] = config.titleWeight * title[i] + config.bodyWeight * body[i]`
  - 결과 벡터를 L2 정규화 (코사인 유사도 계산 최적화)
  - title/body 차원이 다르면 에러

- `findSimilarNotes(target, candidates, threshold?, maxResults?)` → `LinkCandidate[]`
  - 현재 노트 제외 후 전체 후보에 대해 `TagNormalizationService.cosineSimilarity()` 호출
  - threshold(기본 0.85) 이상만 필터
  - similarity 내림차순 정렬, 상위 maxResults(기본 5)개 반환

#### 기존 TagNormalizationService.cosineSimilarity() 재사용

3곳에 분산된 cosine similarity 구현 중 `TagNormalizationService.cosineSimilarity()`를 재사용한다.
이미 `Float32Array` (ArrayLike<number>) 입력을 받으며 OrganizeNoteUseCase에서 사용 중이므로 변경 없음.

### Application Layer

#### ports/NoteEmbeddingCachePort.ts — `NoteEmbeddingCachePort` (ABC)

태그 임베딩 캐시(`TagEmbeddingCachePort`)와 대칭적인 인터페이스. 노트 단위 가중 임베딩을 디스크에 영속화한다.

```typescript
export interface NoteEmbeddingCacheMeta {
  readonly provider: string;
  readonly dimension: number;
  readonly model?: string;
  readonly titleWeight: number;
  readonly bodyWeight: number;
  readonly version: number;
}

export interface NoteEmbeddingEntry {
  readonly notePath: NotePath;
  readonly vector: Float32Array;
  readonly contentHash: string;   // MD5 of (title + body), 변경 감지용
}

export interface NoteEmbeddingCachePort {
  load(): Promise<void>;
  flush(): Promise<void>;

  get(notePath: NotePath): NoteEmbeddingEntry | undefined;
  getMany(notePaths: ReadonlyArray<NotePath>): Map<NotePath, NoteEmbeddingEntry>;
  getAll(): Map<NotePath, NoteEmbeddingEntry>;

  put(entry: NoteEmbeddingEntry): void;
  putMany(entries: ReadonlyArray<NoteEmbeddingEntry>): void;

  delete(notePath: NotePath): void;
  retainOnly(validPaths: ReadonlyArray<NotePath>): void;

  getMeta(): NoteEmbeddingCacheMeta | null;
  setMeta(meta: Omit<NoteEmbeddingCacheMeta, 'version'>): void;
  isCompatible(provider: string, dimension: number, titleWeight: number, bodyWeight: number): boolean;

  needsUpdate(notePath: NotePath, contentHash: string): boolean;

  clear(): Promise<void>;
  size(): number;
}
```

핵심 설계:

- **contentHash 기반 변경 감지**: `needsUpdate(path, hash)`로 콘텐츠 변경 여부를 판별. 변경되지 않은 노트는 임베딩 재계산 생략.
- **가중치 호환성 검사**: `isCompatible()`에 titleWeight/bodyWeight 포함. 가중치 변경 시 전체 캐시 무효화.
- **retainOnly**: vault에서 삭제된 노트의 임베딩을 정리.

#### usecases/OrganizeNoteUseCase.ts — 수정

**제거할 로직**:
1. `availableNotes` 파라미터를 AI `callClassification`에 전달하는 부분 (lines 88-95, 102)
2. `scoreLinkCandidates()` 호출 (line 95) — 토큰 기반 pre-filter 불필요
3. `validateSuggestedLinks()` 호출 (line 106-108) — AI 응답 검증 불필요
4. AI 응답의 `classification.suggestedLinks` 참조

**추가할 로직**:

```typescript
// OrganizeContext에 추가
export interface OrganizeContext {
  // ... 기존 필드
  readonly cachedNoteEmbeddings?: Map<NotePath, Float32Array>;
}
```

```typescript
// execute() 내 링크 제안 (AI 호출 이후, 결과 조립 전)
let suggestedLinks: NotePath[] = [];

if (context?.cachedNoteEmbeddings) {
  // 배치 모드: 미리 계산된 임베딩 사용
  const currentEmb = context.cachedNoteEmbeddings.get(notePath);
  if (currentEmb) {
    const candidates = new Map(context.cachedNoteEmbeddings);
    candidates.delete(notePath);
    suggestedLinks = NoteEmbeddingService.findSimilarNotes(currentEmb, candidates)
      .map(c => c.notePath);
  }
} else {
  // 단일 모드: 즉석 임베딩 계산
  suggestedLinks = await this.computeEmbeddingLinks(notePath, truncatedContent, allNotes);
}
```

새 private 메서드 `computeEmbeddingLinks`:

```typescript
private async computeEmbeddingLinks(
  notePath: NotePath,
  content: string,
  allNotes: ReadonlyArray<NotePath>,
): Promise<NotePath[]> {
  const title = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';

  // 현재 노트 임베딩
  const [titleResp, bodyResp] = await Promise.all([
    this.aiProvider.callEmbedding({ texts: [title] }),
    this.aiProvider.callEmbedding({ texts: [content.slice(0, 8000)] }),
  ]);
  const currentEmb = NoteEmbeddingService.combineEmbeddings(
    titleResp.embeddings[0], bodyResp.embeddings[0],
  );

  // 후보 노트 임베딩 (단일 모드에서는 scoreLinkCandidates로 상위 50개로 축소 후 임베딩)
  const candidates = allNotes.filter(n => n !== notePath);
  const MAX_SINGLE_CANDIDATES = 50;
  const noteTitle = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
  const headings = extractHeadings(content);
  const candidateNames = candidates.map(n => (n as string).replace(/\.md$/, ''));
  const topCandidateNames = scoreLinkCandidates(
    noteTitle, headings, candidateNames, MAX_SINGLE_CANDIDATES, content, [],
  );

  // 후보 제목만으로 간이 임베딩 (본문 읽기 비용 회피)
  const embResp = await this.aiProvider.callEmbedding({ texts: topCandidateNames });

  const candidateEmbMap = new Map<NotePath, Float32Array>();
  for (let i = 0; i < topCandidateNames.length; i++) {
    const matchedPath = candidates.find(n =>
      (n as string).replace(/\.md$/, '').endsWith(topCandidateNames[i]),
    );
    if (matchedPath) {
      candidateEmbMap.set(matchedPath, embResp.embeddings[i]);
    }
  }

  return NoteEmbeddingService.findSimilarNotes(currentEmb, candidateEmbMap)
    .map(c => c.notePath);
}
```

> **단일 모드 제한사항**: 후보 노트의 본문을 모두 읽기에는 비용이 크므로, 단일 모드에서는 scoreLinkCandidates로 상위 50개를 선별 후 **제목만 임베딩**한다. 정밀도는 배치 모드보다 낮지만, AI 기반보다는 안정적이다.

#### AI Classification 프롬프트 변경

**`PromptTemplates.ts`**:
- `classificationUserMessage()`에서 `availableNotes` 파라미터 제거
- `notesInfo` 블록 전체 제거 (링크 후보 목록을 프롬프트에 넣지 않음)
- 시스템 프롬프트에서 `relatedNotes` JSON 필드 + "링크 가능한 노트" 관련 지시 제거

**`AIProviderPort.ts`**:
- `ClassificationRequest.availableNotes` 필드 제거
- `ClassificationResponse.suggestedLinks` 필드 제거

> 4개 AI 어댑터 (OpenAI, Gemini, Ollama, OpenAICompat)에서 `suggestedLinks` 파싱 로직 제거.

#### usecases/RunInboxProcessUseCase.ts (OrganizeFolderUseCase) — 수정

배치 모드에서 노트 임베딩을 1회 계산하여 전체 노트에 재사용한다.

```typescript
// 기존 배치 캐시에 추가
const cachedNoteEmbeddings = new Map<NotePath, Float32Array>();

// 노트 임베딩 사전 계산
if (this.aiProvider && this.noteEmbeddingCache) {
  await this.noteEmbeddingCache.load();

  // 전체 vault 노트에 대해 임베딩 계산 (캐시 우선)
  const allVaultNotes = await this.vault.listNotes();
  const embeddingsToCompute: Array<{ path: NotePath; title: string; body: string }> = [];

  for (const np of allVaultNotes) {
    const contentHash = computeContentHash(np, this.vault);
    if (!this.noteEmbeddingCache.needsUpdate(np, contentHash)) {
      const cached = this.noteEmbeddingCache.get(np);
      if (cached) {
        cachedNoteEmbeddings.set(np, cached.vector);
        continue;
      }
    }
    embeddingsToCompute.push({ path: np, title: extractTitle(np), body: readContent(np) });
  }

  // miss분만 배치 임베딩 호출
  if (embeddingsToCompute.length > 0) {
    const titles = embeddingsToCompute.map(e => e.title);
    const bodies = embeddingsToCompute.map(e => e.body.slice(0, 8000));

    const [titleResp, bodyResp] = await Promise.all([
      this.aiProvider.callEmbedding({ texts: titles }),
      this.aiProvider.callEmbedding({ texts: bodies }),
    ]);

    for (let i = 0; i < embeddingsToCompute.length; i++) {
      const combined = NoteEmbeddingService.combineEmbeddings(
        titleResp.embeddings[i], bodyResp.embeddings[i],
      );
      cachedNoteEmbeddings.set(embeddingsToCompute[i].path, combined);
      this.noteEmbeddingCache.put({
        notePath: embeddingsToCompute[i].path,
        vector: combined,
        contentHash: computeContentHash(embeddingsToCompute[i].path),
      });
    }
  }

  // 정리 + 영속화
  this.noteEmbeddingCache.retainOnly(allVaultNotes);
  await this.noteEmbeddingCache.flush();
}

// OrganizeContext에 cachedNoteEmbeddings 전달
const context: OrganizeContext = {
  // ... 기존 필드
  cachedNoteEmbeddings,
};
```

### Adapters Layer

#### adapters/note-embedding-cache/FileNoteEmbeddingCacheAdapter.ts

`FileTagEmbeddingCacheAdapter`와 동일한 패턴으로 구현. JSON 파일 기반 디스크 캐시.

```typescript
export class FileNoteEmbeddingCacheAdapter implements NoteEmbeddingCachePort {
  private static readonly FILE_NAME = 'note-embeddings.json';
  private static readonly CURRENT_VERSION = 1;
  // ... FileTagEmbeddingCacheAdapter와 동일한 직렬화 패턴
}
```

영속화 파일: `{PLUGIN_DATA_FOLDER}/note-embeddings.json`

| 필드 | 형식 | 설명 |
|------|------|------|
| `meta` | `NoteEmbeddingCacheMeta` | provider, dimension, weights, version |
| `entries` | `Record<string, { vector: string; contentHash: string }>` | notePath → base64 Float32Array + hash |

---

## 클래스 관계 다이어그램

```
                ┌────────────────────────────┐
                │ <<ABC>>                    │
                │ NoteEmbeddingCachePort     │
                │ + get/put/needsUpdate()    │
                └─────────────┬──────────────┘
                              │ implements
                ┌─────────────┴──────────────┐
                │ FileNoteEmbeddingCache     │
                │ Adapter (adapters/)        │
                └────────────────────────────┘

┌─────────────────────────┐  uses  ┌──────────────────────────┐
│ OrganizeNoteUseCase     │───────▶│ NoteEmbeddingService     │
│ (application/)          │        │ (domain/services/)       │
│                         │        │ + combineEmbeddings()    │
│                         │        │ + findSimilarNotes()     │
│                         │        └──────────────────────────┘
│                         │                     │ uses
│                         │        ┌────────────┴─────────────┐
│                         │        │ TagNormalizationService   │
│                         │        │ .cosineSimilarity()       │
│                         │        └──────────────────────────┘
│                         │
│                         │  uses  ┌──────────────────────────┐
│                         │───────▶│ AIProviderPort           │
│                         │        │ .callEmbedding()         │
└─────────────────────────┘        └──────────────────────────┘
          ▲ called by
┌─────────┴───────────────┐  uses  ┌──────────────────────────┐
│ OrganizeFolderUseCase   │───────▶│ NoteEmbeddingCachePort   │
│ (application/)          │        │ (application/ports/)     │
│ + 배치 임베딩 사전 계산 │        └──────────────────────────┘
└─────────────────────────┘
```

### 적용 디자인 패턴

| 패턴 | 적용 위치 | 적용 근거 |
|------|----------|----------|
| Port/Adapter | `NoteEmbeddingCachePort` → `FileNoteEmbeddingCacheAdapter` | 영속화 인프라 격리. 향후 SQLite 등 교체 가능 |
| Strategy | `NoteEmbeddingService` (가중 합산) | 가중치 설정을 외부에서 주입. 추후 다른 합산 전략(concat, attention) 교체 가능 |
| Cache-Aside | `OrganizeFolderUseCase` 배치 사전 캐시 | 캐시 hit → skip, miss → compute → cache 패턴 |

---

## 데이터 흐름

### 배치 모드 (OrganizeFolder)

```
1. vault.listNotes() → allNotes
2. noteEmbeddingCache.load()
3. For each note:
   a. contentHash = MD5(title + body)
   b. cache.needsUpdate(path, hash)?
      - No  → cache.get(path).vector → cachedNoteEmbeddings
      - Yes → embeddingsToCompute에 추가
4. 배치 임베딩 API 호출:
   - titles[] → callEmbedding() → titleEmbeddings[]
   - bodies[] → callEmbedding() → bodyEmbeddings[]
5. combineEmbeddings(title[i], body[i], {0.2, 0.8}) → combined[i]
6. cache.put({ path, vector: combined, contentHash })
7. cache.retainOnly(allNotes) → 삭제된 노트 정리
8. cache.flush() → 디스크 영속화
9. 각 노트 처리 시:
   OrganizeNoteUseCase.execute(context: { cachedNoteEmbeddings })
   → NoteEmbeddingService.findSimilarNotes(currentEmb, candidateEmbs)
   → threshold(0.85) 이상 → top 5 → suggestedLinks
```

### 단일 모드 (OrganizeNote)

```
1. scoreLinkCandidates(토큰 매칭) → top 50 후보
2. callEmbedding(currentTitle) + callEmbedding(currentBody)
   → combineEmbeddings → currentEmb
3. callEmbedding(candidateTitles[50]) → candidateEmbs
4. findSimilarNotes(currentEmb, candidateEmbs)
   → threshold(0.85) 이상 → top 5 → suggestedLinks
```

> 단일 모드는 후보 노트의 본문을 읽지 않고 제목만 임베딩한다 (API 비용 제한).
> 배치 모드는 전체 노트의 제목+본문 임베딩을 캐시하여 정밀도가 높다.

---

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| 기존 AI provider 키 | Y | callEmbedding()에 기존 provider의 API 키 사용 (새 변수 불필요) |

> 임베딩 모델은 각 AI 어댑터의 기본값 사용:
> - OpenAI: `text-embedding-3-small`
> - Gemini: `gemini-embedding-001`
> - Ollama: `nomic-embed-text`
> - OpenAI Compatible: 설정값

---

## 의존성 관계

```
Upstream (이 변경이 의존):
  ├── domain/services/TagNormalizationService  (cosineSimilarity 재사용)
  ├── application/ports/AIProviderPort         (callEmbedding 인터페이스)
  └── adapters/tag-embedding-cache/            (FileTagEmbeddingCacheAdapter 패턴 참조)

Downstream (이 변경에 의존):
  ├── application/usecases/OrganizeNoteUseCase     (링크 제안 로직 교체)
  ├── application/usecases/RunInboxProcessUseCase  (배치 캐시 추가)
  └── main.ts (Composition Root)                   (NoteEmbeddingCache DI 배선)
```

---

## 삭제 대상 코드

| 파일 | 제거 내용 | 이유 |
|------|----------|------|
| `PromptTemplates.ts` | `availableNotes` 관련 프롬프트 블록 (EN/KO 모두) | AI가 더 이상 링크를 제안하지 않음 |
| `AIProviderPort.ts` | `ClassificationRequest.availableNotes`, `ClassificationResponse.suggestedLinks` | 미사용 |
| `OrganizeNoteUseCase.ts` | `validateSuggestedLinks()` private 메서드 | AI 응답 검증 불필요 |
| 4개 AI 어댑터 | `relatedNotes` JSON 파싱 로직 | 미사용 |
| `PromptTemplates.ts` | 시스템 프롬프트의 `relatedNotes` 응답 형식 | 미사용 |

> `scoreLinkCandidates.ts`는 단일 모드에서 후보 축소에 계속 사용하므로 유지한다.

---

## 프롬프트 토큰 절감 효과

| 항목 | Before | After | 절감 |
|------|--------|-------|------|
| 시스템 프롬프트 (링크 지시) | ~100 토큰 | 0 | -100 |
| 유저 메시지 (50개 노트 목록) | ~200 토큰 | 0 | -200 |
| AI 응답 (relatedNotes) | ~30 토큰 | 0 | -30 |
| **합계** | ~330 토큰/노트 | 0 | **-330/노트** |

배치 48노트 기준: ~15,840 토큰 절감 (completion 토큰이 더 비싸므로 비용 절감 효과 큼).

---

## 성능 고려사항

### 임베딩 API 비용

| Provider | 모델 | 토큰당 비용 | 97노트 예상 비용 |
|----------|------|------------|-----------------|
| Gemini | gemini-embedding-001 | 무료 | $0 |
| OpenAI | text-embedding-3-small | $0.02/1M | ~$0.01 |
| Ollama | nomic-embed-text | 로컬 | $0 |

### 초기 임베딩 시간

| 시나리오 | API 호출 | 예상 시간 |
|---------|---------|----------|
| 100노트 vault, 캐시 없음 | 2회 (titles + bodies) | 2-5초 |
| 100노트 vault, 캐시 있음, 변경 5노트 | 2회 (5 titles + 5 bodies) | <1초 |
| 500노트 vault, 캐시 없음 | 2-6회 (배치 분할) | 5-15초 |

### 코사인 유사도 계산

- N노트 × N노트 = O(N²) 비교
- 각 비교: O(D) 연산 (D=3072 for Gemini)
- 100노트: ~10,000 비교 × 3072 곱셈 = ~30M 연산 → <10ms (브라우저 환경)
- 1,000노트: ~1M 비교 → ~100ms (허용 범위)

### 캐시 디스크 사이즈

- 1 Float32Array (3072 dim) = 12,288 bytes → base64 ~16,384 chars
- 100노트: ~1.6MB, 1000노트: ~16MB (관리 가능)

---

## 테스트 계획

### 단위 테스트

| 테스트 대상 | 검증 항목 |
|------------|----------|
| `NoteEmbeddingService.combineEmbeddings` | 가중 합산 정확도, L2 정규화, 차원 불일치 에러 |
| `NoteEmbeddingService.findSimilarNotes` | threshold 필터링, 정렬, maxResults 제한, 빈 입력 |
| `FileNoteEmbeddingCacheAdapter` | load/flush 라운드트립, needsUpdate 정확성, retainOnly 정리 |
| `OrganizeNoteUseCase` (링크) | 배치 모드 cachedNoteEmbeddings 사용, 단일 모드 fallback |

### 통합 테스트

| 시나리오 | 검증 항목 |
|---------|----------|
| 배치 모드 첫 실행 | 전체 임베딩 계산 + 캐시 생성 + 링크 제안 |
| 배치 모드 재실행 (변경 없음) | 캐시 hit 100%, API 호출 0 |
| 배치 모드 재실행 (일부 변경) | 변경 노트만 재계산, 나머지 캐시 |
| 단일 노트 실행 | 후보 50개 제목 임베딩 + 링크 제안 |
| AI 프롬프트 | availableNotes/relatedNotes 미포함 확인 |

### 결정론성 검증

동일 노트에 대해 3회 실행 → 동일한 suggestedLinks 결과 확인.
(AI completion 기반에서는 실패하던 테스트가 임베딩 기반에서는 통과해야 함)

---

## 마이그레이션 전략

### Phase 1: 인프라 구축

1. `NoteEmbeddingService` 구현 + 테스트
2. `NoteEmbeddingCachePort` + `FileNoteEmbeddingCacheAdapter` 구현 + 테스트
3. `main.ts`에 DI 배선

### Phase 2: 배치 모드 전환

4. `OrganizeFolderUseCase`에 노트 임베딩 배치 캐시 추가
5. `OrganizeContext`에 `cachedNoteEmbeddings` 추가
6. `OrganizeNoteUseCase`에서 배치 모드 임베딩 링크 사용

### Phase 3: AI 프롬프트 정리

7. `PromptTemplates`에서 availableNotes/relatedNotes 제거
8. `ClassificationRequest.availableNotes`, `ClassificationResponse.suggestedLinks` 제거
9. 4개 AI 어댑터에서 relatedNotes 파싱 제거
10. `validateSuggestedLinks()` 제거

### Phase 4: 단일 모드 + 정리

11. `OrganizeNoteUseCase`에 단일 모드 `computeEmbeddingLinks()` 추가
12. 전체 빌드 + 테스트 + 수동 검증

---

## 리스크 및 완화

| 리스크 | 완화 |
|--------|------|
| 임베딩 API 미지원 어댑터 (OpenAICompat `embeddingSupported=false`) | fallback: 임베딩 불가 시 빈 링크 반환 (기능 저하, 에러 아님) |
| 대규모 vault (1000+노트) 초기 임베딩 시간 | 진행률 콜백 + 배치 분할 (BATCH_SIZE 20) + 캐시로 2회차부터 즉시 |
| 가중치 0.2/0.8이 특정 도메인에서 부적합 | 설정에서 조절 가능하게 구현 (Phase 2 이후) |
| 캐시 디스크 용량 (1000노트 ~16MB) | 관리 가능 범위. 설정에서 캐시 삭제 버튼 제공 |
| Ollama 임베딩 느림 (단건 루프) | Ollama 어댑터에 배치 지원 추가 검토 (별도 이슈) |

---

## 공개 API (모듈 README로 요약될 부분)

다른 모듈이 import할 수 있는 안정 계약:

| export | 위치 | 설명 |
|--------|------|------|
| `NoteEmbeddingService` | `domain/services/` | 가중 임베딩 합산 + 유사도 검색 |
| `NoteEmbeddingCachePort` | `application/ports/` | 노트 임베딩 캐시 인터페이스 |
| `NoteEmbeddingCacheMeta` | `application/ports/` | 캐시 메타데이터 타입 |
| `NoteEmbeddingEntry` | `application/ports/` | 캐시 엔트리 타입 |
| `LinkCandidate` | `domain/services/` | 유사도 검색 결과 타입 |
| `WeightedEmbeddingConfig` | `domain/services/` | 가중치 설정 타입 |
