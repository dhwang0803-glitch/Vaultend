# Changelog

All notable changes to the **Vaultend** plugin for Obsidian are documented here.

This project follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] (development)

*No unreleased changes.*

---

## [0.4.9] - 2026-07-15

### Fixed
- **취소선 범위 수정**: `text-decoration: line-through`를 텍스트에만 적용, 복원 버튼은 제외.
- **복원 버튼 빨간색 복원**: `.setWarning()` 추가로 시각적 구분 강화.
- **Archive 복원 구현**: `metadata.archivedTo`에 이동 경로 기록 → `moveNote()` 역복원 지원.
- **Dismiss 복구 지원**: 즉시 숨김 → 취소선+복원 버튼으로 변경, 실수로 dismiss한 항목 복구 가능.
- **Vault root 폴더 정규화**: Organize Folder에서 root(`/`) 선택 시 전체 vault 대상으로 동작 (Codex P2).

### Changed
- **Process Inbox → Organize Folder**: 커맨드 팔레트에서 폴더 선택 모달(`FuzzySuggestModal`)로 어떤 폴더든 AI 배치 정리 가능. 폴더 우클릭 컨텍스트 메뉴에서도 실행 가능.

### Removed
- **Create Note 버튼 제거**: 깨진 링크 섹션에서 빈 노트 생성 버튼 제거 (empty note로 재탐지되는 자기모순 해소).

---

## [0.4.8] - 2026-07-14

### Fixed
- **Restore 후 Applied 상태 유실**: 개별/배치 복원 후 re-render 시 Applied 상태가 초기화되던 버그 수정 (`appliedEntries` Map으로 상태 추적).
- **Restore 버튼 `.setWarning()` 제거**: 복원 버튼의 빨간 경고 스타일을 일반 스타일로 변경 (UX 개선).
- **Auto Maintenance가 Restore 덮어쓰기**: 복원 중 자동 스캔이 View를 덮어쓰던 버그 수정 (`restoreInProgress` 플래그 도입).
- **Smart Scheduling 첫 실행 건너뛰기**: 플러그인 로드 후 첫 자동 스캔이 Smart Scheduling에 의해 건너뛰어지던 버그 수정 (`firstRun` 플래그).
- **Undo 후 재-Undo 방지**: History 복원 후 원본 엔트리의 `previousContent`를 제거하여 이중 복원 방지.
- **스캔 시작 전 복원 중 체크 추가**: 자동 스캔이 `execute()` 전에 `isRestoreInProgress()`를 확인하도록 수정 (Codex 교차 검증 P2 수정).

---

## [0.4.7] - 2026-07-14

### Fixed
- **Auto Maintenance 결과 표시**: 자동 스캔 결과가 UI에 표시되지 않던 버그 수정.
- **자동/수동 스캔 경합 방지**: 수동 스캔 중 자동 결과 무시, 자동 스캔 중복 실행 방지.
- **UI 강제 노출 제거**: 자동 스캔 시 View 강제 오픈 대신 Notice 알림만 표시.

---

## [0.4.6] - 2026-07-14

### Fixed
- **Auto Maintenance scheduler**: Settings 변경 시 스케줄러가 즉시 재시작 (기존: 플러그인 재시작 필요).
- **Maintenance Undo**: Apply 액션(링크 제거, 고아 삭제 등)도 복원 가능하도록 확장.
- **Batch restore safety**: 이미 적용된 파괴적 작업의 재실행 방지 (`BatchEntry.status` 상태 관리).
- **Delete orphan edge case**: 존재하지 않는 노트 삭제 시 빈 파일 생성 방지 (null 반환).
- **Restore button double-click**: 복원 버튼 클릭 즉시 비활성화로 중복 실행 방지.

### Changed
- **Undo/Redo → per-item Restore**: 툴바 Undo/Redo 버튼 제거, 적용된 항목 우측에 개별 "복원" 버튼 + 배치 "선택 복원" 버튼으로 전환.

---

## [0.4.5] - 2026-07-14

### Changed
- **References unification**: Removed `suggestedLinks` (AI-extracted wikilinks) and unified to `referencedNotes` (context source notes). Quick Ask and Daily Note now show the same References section.

### Added
- **Hallucinated wikilink sanitization**: AI-generated `[[wikilinks]]` in response body are validated against vault notes — non-existent links have their brackets removed to prevent broken links.
- **Inline tags in Daily Notes**: `formatAnswer()` now includes `**Tags:** #tag1 #tag2` in the answer body, so Daily Note append mode also displays tags.

---

## [0.4.4] - 2026-07-14

### Added
- **Referenced Notes inline preview**: Click a reference in Quick Ask to preview the note's content directly inside the modal.

### Fixed
- **Truncation warning invisible text**: Changed red-on-red warning text to white for readability.
- **Hallucinated reference filtering**: References section now filters out note paths that don't actually exist in the vault.
- **Default max response tokens**: Increased from 4096 to 8192 for longer AI responses.

---

## [0.4.3] - 2026-07-14

### Fixed
- **Quick Ask re-ask overwrite prevention**: Re-asking a question no longer overwrites the previous Q&A file — each answer gets a unique timestamp.
- **Duplicate execution guard**: Prevents multiple simultaneous Quick Ask executions from the same modal.

---

## [0.4.2] - 2026-07-14

### Added
- **AI keyword extraction**: Search queries are now built by AI-extracted keywords instead of raw question text, improving context retrieval quality.
- **Korean particle stripping**: Fallback tokenizer strips Korean particles (은/는/이/가/을/를 etc.) for better BM25 matching.
- **Embeddings auto-sync**: Vector store automatically syncs when vault files change (create/modify/delete/rename).

### Fixed
- **VectorStore metadata compatibility**: Fixed metadata field mismatch between embedding adapter and vector store.
- **Plugin lifecycle**: Fixed cleanup order for vault event listeners on plugin unload.

---

## [0.4.1] - 2026-07-14

### Added
- **Inbox Progress Modal**: Real-time progress bar with note counter, current note name, and cancel button during inbox processing.
- **Max Response Tokens setting**: Configurable token limit for AI responses with slider in settings (default 4096).
- **Quick Ask UX improvements**:
  - Referenced notes source display below AI response
  - Truncation detection with warning banner
  - Auto-link fallback when no search results
  - Tag labels in saved notes
- **Bilingual benchmark golden set**: 100 documents (47 Korean + 53 English) and 40 queries (20 KO + 20 EN) with 3-tier difficulty.
- **CI Hybrid benchmark**: GitHub Actions runs BM25-only and Hybrid (Gemini embedding) benchmarks with regression detection.

### Changed
- **RRF parameters optimized**: Default `rrfK=20`, `rrfEmbeddingWeight=4.0` (was k=60, weight=2.0). Bilingual MRR improved from 92.7% → 96.3%.
- **Organize Note simplified**: Removed redundant `category` field — folder suggestion now serves as the sole organizational axis.

### Fixed
- **BM25 search index initialization**: Fixed race condition where search index was not built before first query.
- **Tag whitespace sanitize**: Tag names with leading/trailing whitespace are now trimmed before saving.
- **Auto Maintenance first run**: Maintenance timer now starts correctly on first plugin load without requiring settings change.
- **Daily Note broken link prevention**: Wikilinks in daily note entries no longer point to non-existent intermediate paths.
- **Inbox watcher feedback loop**: Watcher no longer re-triggers on files being processed, eliminating "1 file changes detected" spam.

---

## [0.4.0] - 2026-07-12

### Added
- **Phase 1 Quality Foundation**:
  - JSON mode for structured AI responses (eliminates parsing failures)
  - BM25 keyword search engine (replaces naive string matching)
  - Content-level duplicate detection via trigram Jaccard similarity
  - Prompt internationalization (bilingual EN/KO system prompts)
  - Exponential backoff retry with jitter for AI API calls
- **Phase 2 Differentiation Features**:
  - Change Tracking with dirty set persistence (`.knowledge-maintenance/dirty-set.json`)
  - Smart Scheduling — skips maintenance when no files have changed
  - TF-IDF corpus-based content duplicate detection (replaces trigram for higher precision)
  - Confidence Gating — low-confidence AI results are flagged, not auto-applied
  - API Embeddings (Gemini) with Reciprocal Rank Fusion (RRF) hybrid search
  - Vector store with JSON persistence for semantic search
- **Embedding benchmark infrastructure**: `vault-benchmark` CLI with `--golden`, `--sweep`, `--model`, `--weight`, `--k` options
- **Scale test**: 5000-document BM25 performance validation (P95 < 10ms)
- **QA infrastructure**: Issue templates (`qa_test_run.yml`, `qa_failure.yml`), manual test plan (30 TCs), embedding benchmark guide
- **CI/CD pipeline**: `ci.yml` (lint + tsc + test + build on PR), `benchmark.yml` (BM25 + Hybrid golden set)
- **DomainErrors i18n**: All domain error messages support EN/KO
- **`versions.json`** release history for BRAT compatibility

### Fixed
- **Embedding-only results lost** (Codex P1): `vault.readNote` fallback when note not in active index
- **Benchmark sweep caching**: Prevents redundant embedding API calls during parameter sweeps
- **Model name consistency**: Unified `gemini-embedding-001` reference across codebase

---

## [0.3.11] - 2026-07-12

### Fixed
- **AI hallucination prevention**: Strengthened prompt to prohibit inventing tags not present in vault's existing tag list.
- **Per-note unique tag recommendations**: AI now considers each note's specific content when selecting from vault tags, preventing generic tag suggestions.

---

## [0.3.10] - 2026-07-12

### Added
- **Empty vault tag creation**: When vault has fewer than 3 existing tags, AI prompt instructs creation of 3+ new relevant tags instead of forcing reuse of an insufficient pool.

---

## [0.3.9] - 2026-07-12

### Added
- **Organize Note token/cost display**: Shows token usage and estimated cost at the bottom of the Organize modal after AI classification.

---

## [0.3.8] - 2026-07-12

### Fixed
- **Tag reuse enforcement**: AI prompt now strictly requires reusing vault's existing tags (frequency-sorted, up to 200). New tags are only created when no existing tag fits the note's content.

---

## [0.3.7] - 2026-07-12

### Changed
- **Organize Note modal UX overhaul**: Interactive modal with editable tag chips, link chips, folder dropdown, and "Apply All" button. Results are no longer just a notification.

### Fixed
- **Codex P1/P2 fixes**: Tag chip removal, folder suggestion validation, modal lifecycle management.

---

## [0.3.6] - 2026-07-12

### Fixed
- **Organize Note tag deduplication**: Prevents suggesting tags already present on the note.
- **Non-existent folder suggestion**: Folder suggestions now validate against actual vault folder structure.

---

## [0.3.5] - 2026-07-12

### Added
- **Organize Note modal**: Dedicated result modal replacing the notification-based display. Shows category, summary, tags, links, and folder suggestion in an interactive UI.
- **Community submission preparation**: MIT LICENSE, comprehensive README rewrite, `versions.json`.

---

## [0.3.4] - 2026-07-12

### Added
- **History log refresh button**: Reload latest entries without restarting Obsidian.
- **Restore action recording**: Undo operations are now recorded in the activity log.
- **GitHub issue templates**: Bug report and feature request templates.

### Fixed
- **Clock adapter initialization order** (Codex P1): `clockAdapter` now initializes before `historyAdapter` to prevent timestamp errors.
- **Select-all control**: Replaced toggle with checkbox for consistent UX in maintenance results.

---

## [0.3.3] - 2026-07-11

### Fixed
- **Dot-prefix folder I/O**: History and search index adapters now use `vault.adapter` for reading/writing to `.knowledge-maintenance/` folder, fixing permission issues on some platforms.

---

## [0.3.2] - 2026-07-11

### Added
- **Undo/Redo for dismiss actions**: Dismissed maintenance items can be undone (reappear) and redone (re-dismissed).

### Fixed
- **History view rendering bug**: Fixed issue where history entries were not displaying correctly after multiple actions.

---

## [0.3.1] - 2026-07-11

### Fixed
- **Filter chip active state**: Severity filter chips now use their respective severity colors (red/orange/blue) instead of generic accent blue when active.

---

## [0.3.0] - 2026-07-11

### Added
- **Internationalization (i18n)**: English as default language with Korean support. Language selector in settings (Auto / English / Korean). Auto-detection based on Obsidian locale.
- **Severity badges**: Visual Critical / Warning / Info badges on maintenance results. Issues are now sorted by severity (critical first).
- **Result filters**: Filter maintenance results by severity chips, issue type chips, and real-time text search by file path — a differentiator over comparable plugins.
- **DynamicAIAdapter**: AI provider, API key, and model changes now apply immediately without restarting the plugin. Uses a proxy pattern with ConfigPort reference and adapter caching.
- **Immediate locale refresh**: Changing the display language instantly updates all open views (Maintenance Results, Log, Inbox Status) without restart.

### Fixed
- **XSS vulnerability in Quick Ask modal**: Replaced `innerHTML` with DOM API (`createEl`) for loading and error messages (Codex P2).
- **Search input focus loss**: Re-render no longer destroys search input focus; cursor position is restored (Codex P2).
- **dismissBatch error handling**: Added per-item try/catch with success/failed counters, matching the `executeBatch` pattern (Codex P3).
- **Filter chip accessibility**: Added `aria-pressed` attribute to severity and type filter chips (Codex P4).

### Changed
- Locale description updated to clarify that command palette names require restart while views update instantly.
- `wireAdapters()` in `main.ts` now creates ConfigPort before AI adapter, removing the static `createAIAdapter()` method.

---

## [0.2.7] - 2026-07-10

### Added
- **Maintenance exclude folders**: New setting to exclude specific folders from maintenance scans (comma-separated). QuickAsk folder is excluded by default.
- **Exclude file patterns**: Glob-based file pattern exclusion for maintenance scans.
- **Exclude tags**: Notes with specified tags are excluded from maintenance scans.

### Fixed
- **Broken link false positives**: `findBrokenLinks()` now receives the full note list, preventing incorrect orphan detection across folder boundaries (Codex P1).
- **Trailing slash normalization**: Folder paths are normalized to prevent filter bypass with trailing slashes (Codex P2).

---

## [0.2.6] - 2026-07-10

### Changed
- **Quick Ask modal UX overhaul**:
  - Markdown rendering via `MarkdownRenderer.renderMarkdown()` for proper formatting of AI responses.
  - Enlarged modal (700px width, 85vh height) for comfortable reading.
  - Added close button (visible before question and after answer).
  - One-click note opening with auto-close (2-touch principle).
  - Ctrl+Enter keyboard shortcut for sending questions.
  - Proper Component lifecycle management (`renderComponent`).

---

## [0.2.5] - 2026-07-10

### Added
- **Quick Ask date-based folder structure**: Answers are saved to `QuickAsk/YYYY-MM-DD/` subfolders for better organization.
- **Maintenance batch editing**: Checkbox selection with batch actions — apply tags, remove links, delete, archive, and dismiss multiple items at once.

### Fixed
- Path casting issue in `createNotePath` for folder paths (Codex P1).

---

## [0.2.4] - 2026-07-09

### Fixed
- **writeNote race condition**: `vault.create()` now falls back to `vault.modify()` when the file already exists, preventing race condition errors during concurrent note creation.

---

## [0.2.3] - 2026-07-09

### Fixed
- **BRAT update detection**: Bumped `manifest.json` and `package.json` versions to match the release tag, fixing BRAT's inability to detect updates.

---

## [0.2.2] - 2026-07-09

### Added
- **Quick Ask dual save mode**: Choose between timestamp-based filenames (one file per question) or Daily Note mode (append to a single daily file). Configurable in settings.
- **Daily Note size splitting**: When a Daily Note exceeds the size limit (default 200KB), a new numbered file is automatically created (e.g., `2026-07-10-2.md`).

### Fixed
- **Gemini JSON code block wrapping**: Added `stripCodeBlock()` to handle Gemini's habit of wrapping JSON responses in markdown code fences.
- **Rate limit retry**: Added `requestWithRetry()` with exponential backoff and `Retry-After` header support for 429/503 responses.
- **Folder creation race condition**: `ensureFolderExists()` now selectively ignores only "Folder already exists" errors instead of swallowing all exceptions.
- **stripCodeBlock case sensitivity**: Added case-insensitive flag to regex for code block detection (Codex P2).

---

## [0.2.1] - 2026-07-09

### Fixed
- **Unnecessary catch-up API calls**: `runCatchUp()` no longer makes AI API calls when `autoApplyInbox` is disabled.
- **AI adapter JSON parsing**: Improved error handling for malformed AI responses.

---

## [0.2.0] - 2026-07-09

### Added
- **Vault Maintenance Result UI**: Sidebar view displaying scan results with per-issue action buttons (delete, remove link, create note, apply tags, dismiss).
- **`ApplyMaintenanceActionUseCase`**: Executes user-approved maintenance actions with `previousContent` backup and history recording.
- **`MaintenanceAction` discriminated union**: 5 action variants — delete-orphan, remove-broken-link, create-missing-note, apply-missing-tags, dismiss.
- **Dismissed issue tracking**: Dismissed items persist across re-renders via `dismissedIds` Set.
- **BRAT release workflow**: GitHub Actions workflow for automated releases (build + attach `main.js`, `manifest.json`, `styles.css`).

### Fixed
- **Dynamic import runtime failure**: Replaced all `await import('obsidian')` with static imports. esbuild marks obsidian as external, so dynamic imports pass the build but fail at runtime in Obsidian's CJS environment.
- **Heading fragment in note creation**: `createMissingNote` now strips `#section` fragments from filenames.
- **Inline tag duplication**: `extractFrontmatterTags` now correctly extracts only frontmatter tags, preventing inline tags from being copied to frontmatter.

---

## [0.1.0] - 2026-07-09

### Added
- **Quick Ask**: One-shot AI queries with auto-save to vault. Supports OpenAI and Google Gemini providers.
- **Inbox Processing**: Automatic note classification, tagging, and folder routing powered by AI.
- **Vault Maintenance Engine**: Automated detection of orphan notes, broken links, missing tags, duplicate candidates, untagged notes, and empty notes.
- **Privacy Rules**: Configurable rules to exclude sensitive notes from AI processing — folder exclude, tag exclude, frontmatter exclude, and content redaction.
- **Clipboard Capture**: Quick capture of clipboard content as a new note.
- **Note Organizer**: AI-powered single-note classification and tagging.
- **Maintenance History Log**: Activity log view tracking all maintenance actions.
- **Inbox Status View**: Dashboard showing inbox processing statistics.
- **Clean Architecture**: Domain-driven design with strict layer separation (domain, application, adapters, UI).

### Infrastructure
- TypeScript + esbuild build pipeline.
- 228 unit tests across 22 test files.
- Pre-commit security audit hook (credential scanning, lint).
- Codex cross-verification pipeline for independent code review.
