# Architecture

> 프로젝트 전체 아키텍처(레이어/흐름/경계)를 기술한다. (`docs` 브랜치에서만 편집)
> 데이터 경로·실행 모드·Repository 간 쓰기 순서가 바뀌면 갱신한다.

## 레이어 개요

Obsidian 플러그인이므로 별도 서버 없이, Plugin 클래스(`main.ts`)가 Composition Root 역할을 한다.

```
┌─────────────────────────────────────────────────┐
│ UI Layer           src/ui/                       │
│   QuickAskModal, MaintenanceLogView,             │
│   InboxStatusView, PluginSettingTab              │
├─────────────────────────────────────────────────┤
│ Composition Root   src/main.ts                   │
│   KnowledgeMaintenancePlugin (DI 조립)           │
├─────────────────────────────────────────────────┤
│ Application Layer  src/application/              │
│   UseCases: QuickAsk, OrganizeNote, Inbox,       │
│             Maintenance, Search, Save, Clipboard │
│   Ports (ABC): AIProvider, VaultAccess,          │
│                SearchIndex, History, Config,      │
│                Clipboard, Clock                  │
├─────────────────────────────────────────────────┤
│ Domain Layer       src/domain/                   │
│   Values: NoteId, NotePath, NoteTitle, ChunkText,│
│           HeadingPath, TagName, Timestamp         │
│   Models: Note, NoteChunk, NoteMetadata,         │
│           SaveTarget, QuickAsk/OrganizeModels,    │
│           PrivacyRule, HistoryEntry              │
│   Errors: DomainErrors                           │
├─────────────────────────────────────────────────┤
│ Adapters Layer     src/adapters/                 │
│   vault/   → ObsidianVaultAdapter                │
│   ai/      → OpenAIAdapter, GeminiAdapter        │
│   search/  → JsonSearchIndexAdapter              │
│   history/ → FileHistoryAdapter                  │
│   clipboard/ → ObsidianClipboardAdapter          │
│   clock/   → SystemClockAdapter                  │
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

### Quick Ask (AI 질의)

```
[사용자] → QuickAskModal.onSubmit()
  → QuickAskUseCase.execute(question)
    → SearchIndexPort.search(question)  → 관련 청크 검색
    → AIProviderPort.ask(prompt, context) → AI 응답 생성
    → SaveNoteUseCase.execute(response)  → 응답 저장
    → HistoryPort.append(entry)          → 이력 기록
  ← QuickAskResult (answer, sources, savedPath)
```

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

## Port → Adapter 매핑

| Port (ABC) | Adapter 구현 | 외부 의존 |
|------------|-------------|----------|
| `AIProviderPort` | `OpenAIAdapter` | OpenAI API |
| `AIProviderPort` | `GeminiAdapter` | Google Gemini API |
| `VaultAccessPort` | `ObsidianVaultAdapter` | Obsidian Vault API |
| `SearchIndexPort` | `JsonSearchIndexAdapter` | 로컬 JSON 파일 |
| `HistoryPort` | `FileHistoryAdapter` | 로컬 파일 시스템 |
| `ClipboardPort` | `ObsidianClipboardAdapter` | Clipboard API |
| `ClockPort` | `SystemClockAdapter` | `Date` |

## AI Provider 전략

`ConfigPort.aiProvider` 설정에 따라 런타임에 AI 어댑터를 교체한다 (Strategy 패턴).

| Provider | Adapter | 기본 모델 |
|----------|---------|----------|
| `openai` | `OpenAIAdapter` | `gpt-4o` |
| `gemini` | `GeminiAdapter` | 설정에 따라 |

## 관련 문서

- 설계 결정 배경: [`decisions.md`](./decisions.md)
- 파일 맵: [`MAP.md`](./MAP.md)
