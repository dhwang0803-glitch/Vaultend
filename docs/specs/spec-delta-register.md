# Spec Delta Register — 구현 참조 문서

- **작성일**: 2026-07-06
- **상태**: Active
- **참조**: `docs/context/adr/ADR-0001-spec-delta-baseline.md`

> Codex 초기 아키텍처 명세와 현재 코드 사이의 차이를 추적한다.
> 스텁 구현 시 이 문서를 먼저 확인하여 초기 명세로의 회귀를 방지한다.
> 코드가 변경될 때 이 문서도 함께 갱신한다.

---

## 요약 대시보드

| 구분 | 건수 | 의미 |
|------|------|------|
| 일치 | 22 | 명세를 구현 가이드로 사용 가능 |
| 의도적 분기 | 9 | 현재 코드 방식 유지 (ADR-0001) |
| 명세만 존재 | 5 | 일부는 의도적 미구현, 일부는 추후 구현 |
| 코드만 존재 | 3 | 명세에 없는 유효한 추가 |
| 회귀 위험 | 6 | 구현 시 명세 따르면 안 됨 |

---

## 1. 아키텍처 일치 항목 (22건)

명세를 그대로 구현 가이드로 사용해도 안전한 부분:

- 레이어 구조: Domain → Application → Adapters → UI/Plugin
- 의존성 방향: 내곽에서 외곽으로만
- 7개 Port 인터페이스: AIProvider, VaultAccess, SearchIndex, History, Config, Clipboard, Clock
- 7개 Value Object (Branded Types): NoteId, NotePath, NoteTitle, ChunkText, HeadingPath, TagName, Timestamp
- 8개 Domain Model: Note, NoteChunk, NoteMetadata, SaveTarget, QuickAskModels, OrganizeModels, PrivacyRule, HistoryEntry
- 6개 Domain Error: NoteNotFoundError, DuplicateNoteError, InvalidNoteContentError, AIProviderError, PrivacyViolationError, RateLimitError
- 6개 Adapter: ObsidianVaultAdapter, OpenAIAdapter, GeminiAdapter, JsonSearchIndexAdapter, FileHistoryAdapter, ObsidianClipboardAdapter, SystemClockAdapter
- 4개 UI: QuickAskModal, MaintenanceLogView, InboxStatusView, PluginSettingTab
- AI Provider Strategy 패턴 (createAIAdapter switch)
- SaveTarget discriminated union 구조
- PluginSettings 인터페이스 필드 (ConfigPort에 정의)
- DEFAULT_SETTINGS 기본값

---

## 2. 의도적 분기 (9건) — 현재 코드가 정답

> 상세 근거: ADR-0001 참조

| ID | 항목 | 규칙 |
|----|------|------|
| D1 | settings 필드 | `declare` 사용, `private!` 사용 금지 |
| D2 | GetHistoryUseCase | 유지. 뷰가 Port를 직접 참조하지 않도록 |
| D3 | AI HTTP 로직 | 어댑터 자체 구현 유지. HttpClient 래퍼 만들지 않음 |
| D4 | ESLint | flat config 유지. eslint-plugin-import 사용하지 않음 |
| D5 | import 경로 | 상대 경로 유지. tsconfig paths 사용하지 않음 |
| D6 | 프롬프트 관리 | PromptTemplates로 통합 예정. 어댑터 인라인 프롬프트 제거 예정 |
| D7 | runCatchUp | 현재 단순 버전 유지 |
| D8 | Notice import | 현재 방식 유지, 향후 통일 |
| D9 | 제품명 | **Noluma** 확정. 옛 이름(KM Plugin, Vaulta) 사용 금지 |

---

## 3. 명세만 존재 — 구현 여부 결정

| ID | 항목 | 명세 섹션 | 결정 |
|----|------|----------|------|
| M1 | RateLimiter 클래스 | 13.4 | Phase 2에서 구현. Phase 1은 429 대응으로 충분 |
| M2 | 토큰 추정 유틸리티 | 13.3 | Phase 1 Quick Ask 구현 시 함께 추가 |
| M3 | startInboxWatcher 구현 | 12.1 | Phase 1에서 구현. types.ts의 DebounceState 활용 |
| M4 | scheduleMaintenanceIfEnabled | 12.4 | Phase 2에서 구현. 명세 코드 거의 그대로 사용 가능 |
| M5 | HttpClient 래퍼 | 13.1 | 구현하지 않음 (D3 결정) |

---

## 4. 코드만 존재 — 명세에 없는 추가

| ID | 항목 | 처리 |
|----|------|------|
| A1 | `src/types.ts` (InboxQueueItem, DebounceState) | 유지. InboxWatcher 구현 시 활용 |
| A2 | `src/constants.ts` (중앙화된 상수) | 유지하되 중복 제거 — SSOT로 삼기 |
| A3 | HistoryFilter 중복 정의 | GetHistoryUseCase의 중복 정의 제거. HistoryPort.ts 것만 사용 |

---

## 5. 회귀 위험 (6건) — 구현 시 주의

### R1. 프롬프트는 UseCase/PromptTemplates 책임

```
❌ 명세 패턴 (따르지 말 것):
  AI 어댑터 내부에 buildClassificationPrompt() 인라인

✅ 올바른 패턴:
  UseCase → PromptTemplates.classifyAndTag() 호출 → 결과를 AI 어댑터의 callCompletion()에 전달
  AI 어댑터는 prompt 문자열을 받아 API만 호출
```

### R2. 도메인 에러 클래스 활용

```
❌ 현재 코드 + 명세 (둘 다 부족):
  throw new Error('노트를 찾을 수 없습니다')

✅ 올바른 패턴:
  throw new NoteNotFoundError(notePath)
  throw new PrivacyViolationError(ruleName)
```

### R3. ConfigPort 한 번만 생성

```
❌ 현재 코드 (명세도 동일):
  wireUseCases() 내에서 configPort 객체 리터럴 생성
  addSettingTab() 내에서 또 생성
  registerViews() 내에서 no-op 버전 또 생성

✅ 올바른 패턴:
  private configPort: ConfigPort  ← 필드로 선언
  wireAdapters()에서 한 번 생성, 전체에서 공유
```

### R4. SearchNotesUseCase 정리

```
현재: import만 있고 미사용.
결정 필요:
  (a) 독립 검색 명령 추가 시 → wireUseCases()에 연결
  (b) QuickAskUseCase가 SearchIndexPort 직접 사용으로 충분 → import 제거
```

### R5. SaveTarget 올바른 타입 생성

```
❌ 현재 코드 (main.ts:236):
  { kind: 'new-note' as any, title: '' as any, position: 'bottom' }

✅ 올바른 패턴:
  const target: SaveTarget = this.settings.defaultSaveTarget === 'daily-note'
    ? { kind: 'daily-note', position: 'bottom' }
    : { kind: 'new-note', title: createNoteTitle('Quick Ask'), folder: createNotePath(this.settings.defaultSaveFolder + '/untitled.md') };
```

### R6. constants.ts를 SSOT로

```
❌ 현재 상태:
  constants.ts: MAINTENANCE_LOG_VIEW_TYPE = 'knowledge-maintenance-log'
  MaintenanceLogView.ts: export const MAINTENANCE_LOG_VIEW_TYPE = 'knowledge-maintenance-log'  ← 중복!
  
  constants.ts: HISTORY_FOLDER = '.knowledge-maintenance/history'
  FileHistoryAdapter.ts: private static readonly HISTORY_FOLDER = '.knowledge-maintenance/history'  ← 중복!

✅ 올바른 패턴:
  constants.ts에서만 정의, 나머지는 import { MAINTENANCE_LOG_VIEW_TYPE } from '../constants'
```

---

## 6. 전체 스텁 목록 (17건)

### Phase 1 — Quick Ask 파이프라인 (10건)

| # | 파일 | 메서드 | 구현 참고 |
|---|------|--------|----------|
| 1 | `QuickAskUseCase` | `buildPrompt()` | `PromptTemplates.quickAsk()` 사용. 명세 섹션 13.2 참고 |
| 2 | `QuickAskUseCase` | `isChunkAllowed()` | `PrivacyRule.isNoteAllowedByRules()` 활용. 모델 내 함수 이미 구현됨 |
| 3 | `QuickAskUseCase` | `extractLinkSuggestions()` | AI 응답에서 `\[\[(.+?)\]\]` 정규식으로 wikilink 파싱 |
| 4 | `QuickAskUseCase` | `formatAnswer()` | 마크다운 포맷 + 출처 표시 + frontmatter tags |
| 5 | `SaveNoteUseCase` | `insertUnderHeading()` | 마크다운 헤딩(`## `) 파싱 후 position('top'\|'bottom')에 따라 삽입 위치 결정 |
| 6 | `SaveNoteUseCase` | `resolveDailyNotePath()` | `settings.dailyNoteFolder` + `formatDate(settings.dailyNoteFormat)` + `.md` |
| 7 | `SaveNoteUseCase` | `formatDate()` | YYYY→연도, MM→월, DD→일 치환. moment 없이 순수 구현 |
| 8 | `ObsidianVaultAdapter` | `parseMetadata()` | Obsidian `CachedMetadata` → `NoteMetadata` 변환. tags, links, frontmatter 추출 |
| 9 | `ObsidianVaultAdapter` | `splitIntoChunks()` | 마크다운 헤딩(`#`~`######`) 기준 분할 → `NoteChunk[]` |
| 10 | `main.ts` | `startInboxWatcher()` | 명세 섹션 12.1 + `types.ts`의 `DebounceState` 활용. 3초 디바운싱 |

### Phase 2 — Organize/Maintenance (7건)

| # | 파일 | 메서드 | 구현 참고 |
|---|------|--------|----------|
| 11 | `OrganizeNoteUseCase` | `findRelevantLinks()` | `PromptTemplates.suggestLinks()` + AI 호출 |
| 12 | `OrganizeNoteUseCase` | `applyOrganization()` | `VaultAccessPort.updateFrontmatter()` + 선택적 파일 이동 |
| 13 | `RunMaintenanceUseCase` | `findDuplicates()` | 제목 유사도(Levenshtein) + 내용 해시 비교 |
| 14 | `RunMaintenanceUseCase` | `findBrokenLinks()` | 모든 노트의 wikilink 대상 파일 존재 확인 |
| 15 | `RunMaintenanceUseCase` | `suggestMissingTags()` | AI 분류 기반 태그 제안 (배치) |
| 16 | `main.ts` | `scheduleMaintenanceIfEnabled()` | 명세 섹션 12.4 거의 그대로 사용 가능 |
| 17 | `PluginSettingTab` | 프라이버시 규칙 UI | 규칙 추가/삭제/토글 인터랙티브 리스트 |

---

## 7. 구현 전 선행 작업 (코드 품질 이슈)

Phase 1 스텁 구현에 들어가기 전에 아래 5건을 먼저 해결한다:

| # | 이슈 | 파일 | 작업 |
|---|------|------|------|
| Q1 | ConfigPort 중복 | `main.ts` | 필드로 한 번 생성, 전체 공유 |
| Q2 | constants.ts SSOT화 | 뷰 파일, 어댑터 파일 | 인라인 상수 → import 교체 |
| Q3 | HistoryFilter 중복 | `GetHistoryUseCase.ts` | 로컬 정의 제거, `HistoryPort`에서 import |
| Q4 | AI 어댑터 인라인 프롬프트 | `OpenAIAdapter.ts`, `GeminiAdapter.ts` | `buildClassificationPrompt()` 제거. UseCase에서 프롬프트 전달 |
| Q5 | SaveTarget as any | `main.ts:236` | 올바른 타입 리터럴로 교체 |

---

## 갱신 이력

| 날짜 | 내용 |
|------|------|
| 2026-07-06 | 초기 작성 — 전수 비교 완료 |
