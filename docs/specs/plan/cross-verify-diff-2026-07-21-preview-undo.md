# 교차 검증 결과 — Organize Selected Preview + Undo

- **검증 대상**: diff — feature/organize-selected-preview (10 files)
- **검증 방법**: CLI 직접 실행
- **검증 모델**: Codex (gpt-5.6-sol)
- **불일치 항목**: 0건
- **Codex 단독 지적**: 3건 (유효: 3, 오탐: 0)
- **오탐률**: 0%

## Codex 단독 지적

| # | 심각도 | 파일 | 지적 내용 | 대응 |
|---|--------|------|----------|------|
| 1 | P1 | main.ts:35-39 | 신규 모듈(relatedNotesSection, OrganizeBatchPreviewModal) import가 diff에 미포함 | 커밋 시 git add로 자연 해결 |
| 2 | P2 | main.ts:847-849 | previewOrganizeNotes에서 실패 시 silent skip — 사용자에게 보고 없음 | Notice 추가 (`notice.organizePreviewFailed`) |
| 3 | P2 | OrganizeBatchPreviewModal applyAll | 태그 적용 성공 → 링크/history 실패 시 rollback 없음 | previousContent 복원 로직 추가 + writeContent 콜백 |

## 수정 사항

- `main.ts`: `previewOrganizeNotes`에 failed 카운트 + Notice 추가
- `OrganizeBatchPreviewModal.ts`: `writeContent` 콜백 추가, applyAll에서 실패 시 previousContent 복원
- `en.ts`, `ko.ts`: `notice.organizePreviewFailed` i18n 키 추가
- `main.ts`: `buildBatchOrganizeCallbacks`에 `writeContent` 배선
