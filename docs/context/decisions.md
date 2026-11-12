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
| 0005 | Quick Ask 멀티턴 채팅 (→ obsidian-vault-chat로 이전) | Superseded | 2026-07-15 |
| 0006 | [클립보드 캡처 기능 제거](./adr/ADR-0006-clipboard-capture-removal.md) | Accepted | 2026-07-16 |
| 0007 | Free/Pro 게이팅 시스템 (→ obsidian-vault-chat로 이전) | Superseded | 2026-07-17 |
| 0008 | [AI API 배치 처리 + Rate Limit Circuit Breaker](./adr/ADR-0008-ai-batch-rate-limit-circuit-breaker.md) | Accepted | 2026-07-19 |
| 0009 | Quick Ask 모듈 분리 (→ obsidian-vault-chat로 이전) | Superseded | 2026-07-20 |
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
- **교차 언어 태그 매칭 — 전체 canonical 비교** (2026-07-16, PR #117, ADR-0004 보완): findDuplicateTags() Stage 2에서 문자열 중복 그룹을 임베딩 비교 대상에서 제외하던 버그 수정. 모든 canonical 그룹을 임베딩 비교에 포함하고, 흡수된 문자열 중복 그룹을 dedup하여 교차 언어 매칭(#game-dev ↔ #게임개발) 동작.
- **클립보드 캡처 제거** (2026-07-16, PR #117, ADR-0006): 플러그인 범위를 vault 내부 관리로 한정. ClipboardPort, CaptureClipboardUseCase, ObsidianClipboardAdapter 및 관련 코드 전체 삭제.
- **AI Rate Limit Circuit Breaker + 배치 처리** (2026-07-19, ADR-0008): Gemini Free RPM 10 제한으로 제안서 생성 6분+ 행 발생. 429 즉시 실패(circuit breaker) + broken link·merge 배치 처리(29회→8회)로 해결. 503만 재시도 유지.
- **Organize 폴더 이동 제안 제거** (2026-07-20, PR #192, ADR-0010): 커뮤니티 리서치 결과 대다수 유저가 flat/Zettelkasten 구조 사용. 폴더 이동 제안 제거하고 절약된 토큰 예산을 태그/링크 정확도 향상에 재투자.
- **LLM 기반 링크 제안 구현 상세** (2026-07-21, PR #208, ADR-0011): `callClassification` 응답에 `onelineSummary` 필드를 피기백하여 추가 API 호출 없이 요약 수집. `NoteEmbeddingCachePort`에 요약 캐시. Organize Folder는 2-pass 배치(Pass 1: 분류+태그+요약 수집, Pass 2: 단일 `callCompletion`으로 LLM 링크 선택). 단일 노트 모드는 캐시된 요약으로 LLM 호출, 캐시 없으면 임베딩 폴백. 토큰 안전장치: `MAX_VAULT_NOTES_FOR_LINK=200`, `maxTokens≤4000`. Provider-agnostic — 기존 `callCompletion` 재사용으로 OpenAI/Gemini/DeepSeek/Ollama 모두 지원.
- **Gemini 모델 계열별 thinking 정책** (2026-11-13, PR #267): Gemini 3.x·2.5 Flash의 thinking 토큰이 `maxOutputTokens`를 소진해 분류·링크·요약이 실패하던 문제 대응. `GeminiGenerationPolicy`가 계열별 설정을 결정 — 2.5 Flash `thinkingBudget: 0`, 3.x Flash/Pro `thinkingLevel: low` + 출력 여유분 2048, lite 계열·규칙 외 모델은 기존 요청 유지. 계열마다 허용 값이 달라(2.5는 `thinkingLevel` 거부, 3.5 Flash Lite는 `thinkingBudget: 0` 거부 등) 실측 매트릭스로 결정. **temperature는 Google 권고(1.0)와 달리 0.1 유지** — `b09eca7`의 분류 비결정성 감소 결정이며, 실측에서 미전송 시 태그 일관성이 같거나 하락(Jaccard 0.47→0.17). 신규 Gemini 모델 추가 시 같은 매트릭스 검증 필요.
- **최대 응답 토큰(`aiMaxTokens`) = 작업별 출력 상한** (2026-11-13, PR #267): 0.8.0 Quick Ask 분리 후 무효였던 설정을 삭제하지 않고(배포·노출된 설정) `MaxResponseTokensAIAdapter` 데코레이터로 `callCompletion` 한도를 `min(작업 한도, 설정값)`으로 재연결. 작업별 고정 한도(링크 300, 요약 ≤2000, 태그·inbox ≤4000)는 출력 형식에 맞춘 의도적 값이므로 대체하지 않고 상한만 씌움. 분류(`callClassification`, 내부 400/500)는 설정 하한 1024보다 작아 적용 대상에서 제외 — 분류 한도를 1024 이상으로 올리면 재설계 필요.
- **종료 모델 자동 전환 절차** (2026-11-13, PR #267): 제공사가 종료한 모델 ID가 저장된 설정을 `RetiredModelMigration`이 로드 시 권장 대체로 교체하고 즉시 저장. 원칙: API가 이미 거부하는 값만 교체, `aiProvider`가 openai(모델)·gemini(임베딩)일 때만 — custom 엔드포인트(프록시 가능)·ollama는 제외. 향후 종료(gpt-4o 2027-01-14, gemini-2.5-pro 2026-12-01 등)도 매핑 추가 + 드롭다운 제거 + What's New 사전 안내 순서로 처리 (`tech-debt.md` DL-1·DL-2).
- **실제 `requestUrl` 오류 동작과 Circuit Breaker 미작동 확인** (2026-11-13, ADR-0008 관련): Obsidian `requestUrl`은 4xx/5xx에서 예외를 던지며(`status`·`headers` 속성, 본문 없음) 단위 테스트 mock 가정과 다름. 이 때문에 ADR-0008의 429 즉시 실패(circuit breaker) 분기가 실제 앱에서 도달하지 않고 메시지 기반 재시도 3회로 동작함(코드 경로 분석, 실제 429 재현 미실시). 처리 계획은 `tech-debt.md` TD-1.
