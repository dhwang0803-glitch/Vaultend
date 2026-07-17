# ADR-0004: Tag Taxonomy Engine — 2단계 중복 태그 탐지

- **Status**: Accepted
- **Date**: 2026-07-16
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/maintenance, area/organize, layer/domain

## Context

Obsidian vault에서 태그는 사용자가 자유롭게 생성하므로 시간이 지나면 동일 개념의 태그가 다양한 변형으로 분산된다 (`#game-dev`, `#GameDev`, `#game_dev`). 한국어-영어 혼용 vault에서는 교차 언어 중복 (`#game-dev` vs `#게임개발`)도 발생한다. 이를 자동으로 탐지하고 병합하는 기능이 필요했다.

## Decision

**2단계 중복 태그 탐지** 아키텍처를 채택한다.

### Stage 1 — 문자열 정규화 (비용 0)
- `TagNormalizationService.normalizeForComparison()`: `#` 제거 → lowercase → 비알파벳/비한글 제거
- `buildCanonicalIndex()`: 정규화 키로 그루핑, 빈도순 정렬 → 최다 사용 변형이 canonical
- 2+ variants 있는 그룹을 stringDuplicates로 판정

### Stage 2 — 임베딩 유사도 (opt-in, AI 비용 발생)
- Stage 1에서 미탐지된 canonical 태그만 대상
- `AIProviderPort.callEmbedding()` 일괄 호출 → pairwise cosine similarity
- **EMBEDDING_SIMILARITY_THRESHOLD = 0.85** (교차 언어 매칭에 충분히 보수적)
- **MAX_EMBEDDING_TAGS = 500** (O(N²) 비교 방지)

### 도메인 서비스 배치
- `TagNormalizationService` → `src/domain/services/` (순수 로직, 외부 의존 없음)
- `CanonicalTagGroup` 인터페이스 → 같은 파일에 co-located
- `DuplicateTagGroup` 모델 → `src/domain/models/OrganizeModels.ts`

### 병합 액션
- `ApplyMaintenanceActionUseCase.mergeDuplicateTags()`: frontmatter 태그만 치환 (인라인 태그 미수정)
- undoable: false (다중 파일 수정이라 복원 미지원)

### Organize 연동
- `OrganizeNoteUseCase`에서도 `resolveToCanonical()` + 임베딩 유사도로 태그 정규화
- `OrganizeContext`에 캐시 필드 추가 → 배치 모드에서 vault 쿼리/임베딩 호출 1회로 최적화 (200→4 I/O)

## Consequences

### Positive
- 동일 개념 태그의 자동 통합으로 vault 태그 일관성 유지
- 교차 언어 태그 매칭 (`#AI` ↔ `#인공지능`) 지원
- Stage 1은 비용 없이 즉시 동작, Stage 2는 opt-in으로 비용 통제
- Organize 배치에서 I/O 200→4 최적화

### Negative / Trade-offs
- 임베딩 Stage 2는 API 비용 발생 (BYOK 키 필요)
- O(N²) pairwise 비교로 500 태그 캡 필요
- 인라인 태그(`#tag` 본문 내)는 병합 미지원 — frontmatter만

### Follow-ups
- 인라인 태그 병합 지원 검토
- 임베딩 캐싱으로 반복 호출 최적화

## Alternatives Considered

- **편집 거리(Levenshtein) 기반 탐지**: 한국어-영어 교차 매칭 불가 — 기각
- **LLM 분류 기반 탐지**: API 비용 과다 + 결과 비결정적 — 기각
- **태그 정규화만 (임베딩 없이)**: 교차 언어 매칭 포기 → 차별점 상실 — 기각

## References

- PR #116: feat: Tag Taxonomy Engine + Maintenance 중복 태그 탐지
- ADR-0002: API 기반 임베딩 (BYOK API) — 임베딩 인프라 기반
