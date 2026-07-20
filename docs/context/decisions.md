# Architecture Decision Records (ADR)

> 설계 결정의 **배경과 맥락**을 남기는 문서. (`docs` 브랜치에서만 편집)
> 개별 ADR은 [`adr/`](./adr/) 하위에 `ADR-NNNN-slug.md`로 작성하고, 본 파일은 **인덱스**로만 사용한다.

## 작성 규칙

1. 새 결정은 `adr/ADR-NNNN-slug.md` 파일로 추가 (NNNN은 4자리 zero-padded, 1부터 순차).
   `/adr <제목>` 슬래시 커맨드로 템플릿 생성 + 인덱스 추가를 자동화할 수 있다.
2. 기존 결정을 **뒤집는** 경우: 원본 ADR에 `Superseded by ADR-NNNN` 표기 + 새 ADR 추가. **삭제 금지**.
3. 본 인덱스에 `# / Title / Status / Date` 한 줄을 추가한다.
4. 템플릿: [`adr/ADR-0000-template.md`](./adr/ADR-0000-template.md) 복사 후 작성.

## Status 정의

- `Proposed` — 검토 중
- `Accepted` — 적용됨 (현행)
- `Deprecated` — 더 이상 권장되지 않음 (대체 없음)
- `Superseded` — 다른 ADR로 대체됨

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 0001 | [Codex 초기기획 분기 기준선](./adr/ADR-0001-spec-delta-baseline.md) | Accepted | 2026-07-06 |
| 0002 | [API 기반 임베딩 (BYOK API)](./adr/ADR-0002-api-based-embeddings.md) | Accepted | 2026-07-12 |
| 0003 | [Inbox 제거 및 Organize Folder 리네이밍](./adr/ADR-0003-inbox-removal-organize-folder.md) | Accepted | 2026-07-16 |
| 0004 | [Tag Taxonomy Engine — 2단계 중복 태그 탐지](./adr/ADR-0004-tag-taxonomy-engine.md) | Accepted | 2026-07-16 |
| 0005 | [Quick Ask 원샷 → 멀티턴 채팅 전환](./adr/ADR-0005-quickask-multiturn-chat.md) | Superseded (ADR-0009) | 2026-07-15 |
| 0006 | [클립보드 캡처 기능 제거](./adr/ADR-0006-clipboard-capture-removal.md) | Accepted | 2026-07-16 |
| 0007 | [Free/Pro 기능 게이팅 시스템](./adr/ADR-0007-free-pro-gating.md) | Accepted | 2026-07-17 |
| 0008 | [AI API 배치 처리 + Rate Limit Circuit Breaker](./adr/ADR-0008-ai-batch-rate-limit-circuit-breaker.md) | Accepted | 2026-07-19 |
| 0009 | [Quick Ask 모듈 분리 — obsidian-vault-chat로 이전](./adr/ADR-0009-quickask-extraction.md) | Accepted | 2026-07-20 |
| 0010 | [Organize Note/Folder 폴더 이동 제안 제거](./adr/ADR-0010-remove-folder-move-suggestion.md) | Accepted | 2026-07-20 |
| 0011 | [임베딩 → LLM 기반 링크 제안 전환](./adr/ADR-0011-llm-link-suggestion.md) | Accepted | 2026-07-21 |

## 구현 결정 메모 (비-ADR)

> ADR로 올리기엔 가벼우나 **동작 반전**이라 drift 방지용으로 기록하는 항목.
> 형식: `- **<요약>** (YYYY-MM-DD, PR #NN): <무엇을 왜 바꿨는지 + 무엇을 supersede 하는지>`

- **Codex 명세 대신 현재 코드 우선** (2026-07-06, ADR-0001): 초기 Codex 아키텍처 명세와 현재 코드를 전수 비교. 의도적 분기 9건, 회귀 위험 6건 식별. 스텁 구현 시 현재 코드 방식을 따르도록 기준선 수립.
- **TF-IDF cosine → trigram Jaccard 교체** (2026-07-12, PR #49): 콘텐츠 중복 탐지에 trigram Jaccard 대신 TF-IDF cosine similarity 사용. threshold 0.6 (trigram 0.7보다 낮음 — TF-IDF가 더 discriminating). `TfIdfCorpus` 도메인 서비스로 구현, 코퍼스 통계는 `.vaultend/tfidf-corpus.json`에 영속화.
- **Change Tracking dirty set** (2026-07-12, PR #49): vault 파일 변경 이벤트 → dirty set 기록. 유지보수 스케줄러가 dirty set 비면 skip (smart scheduling). dirty set은 `.vaultend/dirty-set.json`에 영속화. plugin unload 시 persist.
- **Tag 병합 undoable: false** (2026-07-16, PR #116, ADR-0004): 중복 태그 병합은 다수 파일의 frontmatter를 수정하므로 단일 undo로 복원 불가. History에 기록은 하되 undo 버튼 비활성.
- **OrganizeContext 배치 I/O 최적화** (2026-07-16, PR #116, ADR-0004): Organize Folder 배치 실행 시 vault 쿼리 + 임베딩 호출을 1회로 통합. `OrganizeContext` 인터페이스로 캐시 전달. 단일 노트 모드는 fallback으로 개별 호출.
- ~~**Quick Ask 매 턴 재검색** (2026-07-15, PR #114, ADR-0005): 멀티턴 채팅에서 대화 이력만 사용하지 않고 매 턴 hybridSearch()를 재실행. 대화가 깊어져도 vault의 최신 컨텍스트를 반영하기 위함.~~ → **Superseded**: Quick Ask 전체가 obsidian-vault-chat으로 이전됨 (2026-07-20, PR #169, ADR-0009).
- **교차 언어 태그 매칭 — 전체 canonical 비교** (2026-07-16, PR #117, ADR-0004 보완): findDuplicateTags() Stage 2에서 문자열 중복 그룹을 임베딩 비교 대상에서 제외하던 버그 수정. 모든 canonical 그룹을 임베딩 비교에 포함하고, 흡수된 문자열 중복 그룹을 dedup하여 교차 언어 매칭(#game-dev ↔ #게임개발) 동작.
- **클립보드 캡처 제거** (2026-07-16, PR #117, ADR-0006): 플러그인 범위를 vault 내부 관리로 한정. ClipboardPort, CaptureClipboardUseCase, ObsidianClipboardAdapter 및 관련 코드 전체 삭제.
- **Free/Pro 게이팅 — 진입점 전용** (2026-07-17, PR #128, ADR-0007): 게이팅은 main.ts 커맨드 핸들러와 UI View에서만 수행. UseCase/Domain은 라이선스를 모름. LicensePort 인터페이스로 검증 방식 교체 가능. 초기 LocalLicenseAdapter는 로컬 체크섬만 사용 (Phase 3에서 Ed25519 전환).
- **Grace period 영속화** (2026-07-17, PR #128): 기존 사용자 14일 유예를 `proGraceDeadline`에 영속화. Codex 교차검증에서 재시작 시 무한 갱신 버그 발견 → `loadSettings()` 마이그레이션 후 즉시 `saveData()` 호출로 수정.
- **Pro 게이팅 재분류** (2026-07-18, PRD v2): `smart-scheduling`은 `auto-maintenance`의 하위 동작으로 통합 (별도 `ProFeatureId` 제거). `batch-merge-tags`는 Free로 전환 (사용자 API를 쓰므로 게이팅 부당). 결과적으로 `ProFeatureId`는 `organize-folder`과 `auto-maintenance` 2개만 유지. ADR-0007 부분 수정.
- **AI Rate Limit Circuit Breaker + 배치 처리** (2026-07-19, ADR-0008): Gemini Free RPM 10 제한으로 제안서 생성 6분+ 행 발생. 429 즉시 실패(circuit breaker) + broken link·merge 배치 처리(29회→8회)로 해결. 503만 재시도 유지.
- **Quick Ask 모듈 분리** (2026-07-20, PR #169, ADR-0009): "Vault Dependabot" 포지셔닝에 맞지 않는 AI 채팅 기능을 별도 플러그인(obsidian-vault-chat)으로 이전. QuickAskUseCase, QuickAskModal, QuickAskModels, 관련 프롬프트·CSS·i18n·설정 전체 삭제 (-2,425줄). TokenUsage 인터페이스는 공유 타입으로 `src/domain/models/TokenUsage.ts`에 보존.
- **Organize 폴더 이동 제안 제거** (2026-07-20, PR #192, ADR-0010): 커뮤니티 리서치 결과 대다수 유저가 flat/Zettelkasten 구조 사용. 폴더 이동 제안 제거하고 절약된 토큰 예산을 태그/링크 정확도 향상에 재투자. 21개 파일 -419줄. Vault Refactor(Pro)의 폴더 코드는 유지.
- **LLM 기반 링크 제안 구현 상세** (2026-07-21, PR #208, ADR-0011): `callClassification` 응답에 `onelineSummary` 필드를 피기백하여 추가 API 호출 없이 요약 수집. `NoteEmbeddingCachePort`에 요약 캐시. Organize Folder는 2-pass 배치(Pass 1: 분류+태그+요약 수집, Pass 2: 단일 `callCompletion`으로 LLM 링크 선택). 단일 노트 모드는 캐시된 요약으로 LLM 호출, 캐시 없으면 임베딩 폴백. 토큰 안전장치: `MAX_VAULT_NOTES_FOR_LINK=200`, `maxTokens≤4000`. Provider-agnostic — 기존 `callCompletion` 재사용으로 OpenAI/Gemini/DeepSeek/Ollama 모두 지원.
