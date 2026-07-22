# 교차 검증 결과 — 2026-07-22 bugfix batch

## 검증 대상
- 유형: diff (unstaged)
- 브랜치: `development`
- 변경 파일: 11개 (10 코드 + 1 회고)

## 검증 방법
- CLI 직접 실행: `codex exec` (unstaged diff 리뷰)
- 검증 모델: Codex (gpt-5.6-sol)

## 지적 사항

### P4-LOW: NoteEmbeddingService.test.ts — 임계값 경계 테스트 부재
- **파일**: `src/domain/services/__tests__/NoteEmbeddingService.test.ts:102`
- **내용**: 0.40~0.55 사이 유사도 후보가 없어 임계값 변경의 실제 동작 검증 불가
- **사실 확인**: 유효
- **대응**: 향후 테스트 보강 (현재 변경은 기능 정확성에 영향 없음)

### P4-LOW: extractFrontmatterTags 중복 구현 + 회귀 테스트 부재
- **파일**: `ApplyMaintenanceActionUseCase.ts:304`, `ApplyOrganizeVaultUseCase.ts:535`
- **내용**: 동일 파서가 2개 파일에 중복. 따옴표 제거 테스트 없음
- **사실 확인**: 유효
- **대응**: 향후 공용 유틸리티로 추출 검토

### P4-LOW: tagsOnly 링크 적용 방어적 차단 부재
- **파일**: `OrganizeBatchPreviewModal.ts:87,162`
- **내용**: UI에서 링크 숨기지만 applyAll()에서 직접 차단하지 않음
- **사실 확인**: 유효 (백엔드 빈 배열 반환에 의존)
- **대응**: 향후 applyAll()에 `!this.tagsOnly` 가드 추가 권장

## 종합 판정
- 불일치 항목: 0건
- Codex 단독 지적: 3건 (유효: 3, 오탐: 0)
- 합의 항목: 해당 없음
- 오탐률: 0%
- **종합: WARN — P1~P3 없음, P4 테스트 보강 권고만**
