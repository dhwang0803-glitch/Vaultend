# 교차 검증 결과 — 2026-07-22 Batch Undo

- **검증 대상**: diff — development (4 files: i18n en/ko, OrganizeFolderResultView, OrganizeTagsView)
- **검증 방법**: CLI 직접 실행 (`codex review --base development`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **불일치 항목**: 0건
- **Codex 단독 지적**: 1건 (유효: 1, 오탐: 0)
- **오탐률**: 0%

## Codex 단독 지적

| # | 심각도 | 파일 | 지적 내용 | 대응 |
|---|--------|------|----------|------|
| 1 | P1 | OrganizeTagsView.ts:514-515 | 배치 undo가 apply 순서대로 처리 — 같은 노트에 영향 주는 태그 병합이 겹칠 때, 역순이 아니면 이전 병합의 스냅샷이 이후 undo로 덮어씌워짐 | 수정 완료 — `[...selected].reverse()` 적용 (양쪽 뷰 모두) |

## 사실 확인

- **P1 역순 undo**: 유효. `HistoryPort.undo()`는 `previousContent`(전체 파일 내용 스냅샷)를 복원한다. 병합 A→B 순서로 적용 시, B의 스냅샷은 A 적용 후 상태. A를 먼저 undo하면 원본 복원 → B undo 시 A 적용 후 상태 재복원 = A 재적용. 역순(B→A)이 정확한 복원 순서.
- OrganizeFolderResultView는 노트별 독립 처리(겹침 불가)이지만 방어적으로 동일 패턴 적용.

## 수정 사항

- `src/ui/OrganizeTagsView.ts`: `undoBatch()` — `[...selected].reverse()`
- `src/ui/OrganizeFolderResultView.ts`: `undoBatch()` — `[...selected].reverse()`

## 종합 판정

Codex가 Claude가 놓친 순서 의존성 버그를 정확히 발견. 즉시 수정 완료.
