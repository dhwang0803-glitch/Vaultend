# 교차 검증 보고서 — 2026-07-06 feature/phase4-tests

## 검증 메타

- **대상**: diff — `feature/phase4-tests` vs `development`
- **방법**: CLI 직접 실행 (`codex review --base development`)
- **모델**: Codex (gpt-5.4)
- **변경 파일**: 15개 (테스트 12 + 인프라 3)

## 결과 요약

| 지표 | 값 |
|------|-----|
| 불일치(Disagreement) | 0건 |
| Codex 단독 지적 | 2건 (유효 2, 오탐 0) |
| 합의(Agreement) | 0건 |
| 오탐률 | 0% |

## Codex 지적 상세

### [P2] suggestedFolder 버그를 테스트에 고정 — CONFIRMED, FIXED

- **파일**: `src/application/usecases/__tests__/OrganizeNoteUseCase.test.ts:180-195`
- **지적**: `suggestedFolder`가 `"Projects"` 같은 폴더 경로인데 `createNotePath()`에 전달하여 `.md` 검증 실패 → throw. 테스트가 이 에러를 기대 동작으로 단언하여 향후 수정 시 CI가 깨짐.
- **사실 확인**: 유효. `OrganizeModels.ts`에서 `suggestedMoveTarget`이 `NotePath` 타입으로 선언되어 있었고, `OrganizeNoteUseCase.ts`에서 `createNotePath(classification.suggestedFolder)`를 호출하고 있었음.
- **대응**: 프로덕션 코드 + 테스트 모두 수정 완료
  - `OrganizeModels.ts`: `suggestedMoveTarget` 타입을 `NotePath` → `string`으로 변경
  - `OrganizeNoteUseCase.ts`: `createNotePath()` 호출 제거, 폴더 경로를 직접 저장
  - 테스트: 에러 단언 → 올바른 이동 동작 단언으로 변경

### [P3] test-utils가 프로덕션 tsc에 포함 — CONFIRMED, FIXED

- **파일**: `src/test-utils/mock-ports.ts:1`
- **지적**: `tsconfig.json`의 `include`가 `src/**/*.ts`이고 `exclude`에 `*.test.ts`만 있어서, `src/test-utils/`가 프로덕션 빌드에 포함됨. `vitest` import가 들어있어 `npm ci --omit=dev` 환경에서 빌드 실패.
- **사실 확인**: 유효. esbuild 번들에는 포함되지 않지만 `tsc --noEmit` 단독 실행 시 문제 발생 가능.
- **대응**: `tsconfig.json`의 `exclude`에 `"src/test-utils"` 추가.

## 수정 반영

- P2 1건: 프로덕션 버그 수정 + 테스트 갱신
- P3 1건: tsconfig.json exclude 추가
- 빌드 확인: `tsc --noEmit` 0 에러, vitest 120 tests pass
