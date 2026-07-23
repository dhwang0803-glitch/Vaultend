# 교차 검증 결과: Nested Tag 버그 수정 (2026-07-23)

## 메타

- **검증 대상**: diff — nested tag 파싱/Edit 모달/UI 수정 7개 파일
- **검증 방법**: CLI 직접 실행 (`codex review --base development`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **오탐률**: 0% (2건 모두 유효)

## Codex 지적 사항

### P1: `listNotesWithMetadata()`에 `normalizeNestedTag` 미적용

- **파일**: `src/adapters/vault/ObsidianVaultAdapter.ts:236`
- **지적**: `parseMetadata()`와 `listAllTags()`에는 `normalizeNestedTag()`를 적용했지만, `listNotesWithMetadata()`의 태그 수집 로직에는 적용하지 않았음. `OrganizeTagsUseCase.buildDuplicateTagGroups()`가 이 메서드로 역인덱스를 빌드하므로, 정규화된 태그와 비정규화 태그 간 불일치로 `affectedNotes`가 비어짐.
- **판정**: ✅ 유효 (사실 확인 완료)
- **대응**: 즉시 수정 — `listNotesWithMetadata()`의 `cache.tags`와 `frontmatter.tags` 수집에 `normalizeNestedTag()` 적용

### P2: Maintenance에서 canonical-only 노트를 affected에 포함

- **파일**: `src/application/usecases/RunMaintenanceUseCase.ts:609-612`
- **지적**: `hasNonCanonicalVariant` → `hasAnyVariant` 변경으로 canonical 태그만 있는 노트까지 affected에 포함됨. Maintenance 워크플로우에서는 `mergeDuplicateTags()`가 replaceTags만 치환하므로, canonical-only 노트는 실제 변경 대상이 아님. 불필요한 파일 나열 및 처리 시도.
- **판정**: ✅ 유효 (사실 확인 완료)
- **대응**: 즉시 수정 — `RunMaintenanceUseCase`는 원래 `hasNonCanonicalVariant` 로직으로 복원. `OrganizeTagsUseCase`는 Edit 모달에서 canonical 변경이 가능하므로 `allTagsInGroup` (canonical 포함) 유지.

## 합의 사항

- `normalizeNestedTag()` 함수 설계와 `createTagName`/`sanitizeTagName` 적용: 적절
- `computeNestedPath` child `#` 제거: 적절
- Edit 모달 `includedVariants` 초기화 + `syncCheckboxes()`: 적절
- UI 드롭다운 전환: 적절

## 종합

| 항목 | 값 |
|------|-----|
| 총 지적 | 2건 |
| 유효 | 2건 (P1: 1, P2: 1) |
| 오탐 | 0건 |
| 수정 완료 | 2건 모두 즉시 수정 |
| 테스트 | 599/599 통과 |
| 빌드 | 성공 |
