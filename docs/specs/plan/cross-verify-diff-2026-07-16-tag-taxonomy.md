# 교차 검증 보고서: Tag Taxonomy Engine + 중복 태그 탐지

- **날짜**: 2026-07-16
- **검증 대상**: diff (unstaged changes, 17 files, +431/-27)
- **검증 방법**: CLI 직접 실행 (`codex exec`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **오탐률**: 11% (9건 중 1건 오탐)

---

## 지적 사항

| # | 심각도 | 파일 | 지적 | 판정 | 조치 |
|---|--------|------|------|------|------|
| 1 | P2-HIGH | ApplyMaintenanceActionUseCase:218 | `undoable: true`인데 다중 파일 undo 미지원 — Undo 항상 실패 | CONFIRMED | `undoable: false`로 변경 |
| 2 | P2→P3 | ApplyMaintenanceActionUseCase:174 | 탐지(metadata.tags)와 병합(frontmatter만) 범위 불일치 | PLAUSIBLE | 설계상 frontmatter 한정 (계획 명시), PR 문서화 |
| 3 | P2-HIGH | OrganizeNoteUseCase:195 | 세션 태그 임베딩 미누적, 교차 언어 해석 불가 | CONFIRMED | 세션 태그 임베딩 증분 누적 추가 |
| 4 | P2-HIGH | RunMaintenanceUseCase:570 | O(N^2) 태그 수 상한 없음 | CONFIRMED | MAX_EMBEDDING_TAGS=500 캡 추가 |
| 5 | P2-HIGH | RunMaintenanceUseCase:517 | singleton만 임베딩 비교, 다중 변형 그룹 누락 | CONFIRMED | 모든 canonical 그룹으로 확장 |
| 6 | P3-MEDIUM | OrganizeNoteUseCase:120 | 임베딩 해석 후 현재 태그 재필터링 누락 | CONFIRMED | 최종 필터 추가 |
| 7 | P3-MEDIUM | OrganizeNoteUseCase:142 | isNewFolder에 50개 제한 폴더셋 사용 | 오탐 | 기존 코드, 이 PR 변경 아님 |
| 8 | P3-MEDIUM | OrganizeNoteUseCase:56 | listNotes() 매 노트 호출 | CONFIRMED | OrganizeContext에 cachedAllNotes 추가 |
| 9 | P4-LOW | RunMaintenanceUseCase:597 | 빈 catch로 모든 에러 무시 | CONFIRMED | 설계상 graceful degradation 수용 |

## 수정 완료 확인

- tsc --noEmit: 통과
- npm run lint: 통과
- npm run test: 450 tests passed

## 종합

P2 4건 즉시 수정, P3 2건 추가 수정. 수정 후 PASS.
