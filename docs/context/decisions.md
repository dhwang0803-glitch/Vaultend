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
| 0005 | [Quick Ask 원샷 → 멀티턴 채팅 전환](./adr/ADR-0005-quickask-multiturn-chat.md) | Accepted | 2026-07-15 |

## 구현 결정 메모 (비-ADR)

> ADR로 올리기엔 가벼우나 **동작 반전**이라 drift 방지용으로 기록하는 항목.
> 형식: `- **<요약>** (YYYY-MM-DD, PR #NN): <무엇을 왜 바꿨는지 + 무엇을 supersede 하는지>`

- **Codex 명세 대신 현재 코드 우선** (2026-07-06, ADR-0001): 초기 Codex 아키텍처 명세와 현재 코드를 전수 비교. 의도적 분기 9건, 회귀 위험 6건 식별. 스텁 구현 시 현재 코드 방식을 따르도록 기준선 수립.
- **TF-IDF cosine → trigram Jaccard 교체** (2026-07-12, PR #49): 콘텐츠 중복 탐지에 trigram Jaccard 대신 TF-IDF cosine similarity 사용. threshold 0.6 (trigram 0.7보다 낮음 — TF-IDF가 더 discriminating). `TfIdfCorpus` 도메인 서비스로 구현, 코퍼스 통계는 `.vaultend/tfidf-corpus.json`에 영속화.
- **Change Tracking dirty set** (2026-07-12, PR #49): vault 파일 변경 이벤트 → dirty set 기록. 유지보수 스케줄러가 dirty set 비면 skip (smart scheduling). dirty set은 `.vaultend/dirty-set.json`에 영속화. plugin unload 시 persist.
- **Tag 병합 undoable: false** (2026-07-16, PR #116, ADR-0004): 중복 태그 병합은 다수 파일의 frontmatter를 수정하므로 단일 undo로 복원 불가. History에 기록은 하되 undo 버튼 비활성.
- **OrganizeContext 배치 I/O 최적화** (2026-07-16, PR #116, ADR-0004): Organize Folder 배치 실행 시 vault 쿼리 + 임베딩 호출을 1회로 통합. `OrganizeContext` 인터페이스로 캐시 전달. 단일 노트 모드는 fallback으로 개별 호출.
- **Quick Ask 매 턴 재검색** (2026-07-15, PR #114, ADR-0005): 멀티턴 채팅에서 대화 이력만 사용하지 않고 매 턴 hybridSearch()를 재실행. 대화가 깊어져도 vault의 최신 컨텍스트를 반영하기 위함.
