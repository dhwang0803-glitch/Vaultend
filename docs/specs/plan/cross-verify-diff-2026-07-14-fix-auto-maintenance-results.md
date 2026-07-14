# 교차 검증 결과 — feature/fix-auto-maintenance-results (2026-07-14)

## 검증 정보

- **검증 대상**: diff — Auto Maintenance 스캔 결과 UI 표시
- **검증 방법**: CLI 직접 실행 (`codex exec`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **불일치 항목**: 0건
- **Codex 단독 지적**: 4건 (유효: 4, 오탐: 0)
- **합의 항목**: Clean Architecture 위반 없음, 보안 위반 없음

## Codex 지적 및 대응

| # | 심각도 | 지적 내용 | 사실 확인 | 대응 |
|---|--------|----------|----------|------|
| 1 | P3 | 수동 스캔 중 자동 스캔 결과가 덮어쓸 수 있음 | CONFIRMED | `isScanInProgress()` 체크 추가, 수동 스캔 중이면 자동 결과 무시 |
| 2 | P3 | 매 주기 UI 강제 노출로 사용자 작업 방해 | CONFIRMED | View가 열려 있으면 결과만 갱신, 닫혀 있으면 Notice만 표시 (activateView 제거) |
| 3 | P3 | Notice 건수 ≠ View 건수 (dismissed 필터링 차이) | CONFIRMED | View가 닫혀 있으면 Notice만 표시하는 방식으로 건수 불일치 경로 축소 |
| 4 | P4 | View 생성 실패 시에도 Notice 표시 | 유효 (극히 드문 시나리오) | View 존재 시에만 showPlan() 호출, Notice는 항상 표시 (발견 알림은 유효) |

## 추가 수정

- `isMaintenanceRunning` 가드 추가: 자동 스캔끼리 중복 실행 방지 (setInterval 콜백 재진입 방어)

## 수정 후 검증

- TypeScript 빌드: PASS
- Vitest 407 테스트: ALL PASS
