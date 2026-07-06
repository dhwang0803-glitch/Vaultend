# <MODULE_NAME> 구현 계획 (Phase)

- **브랜치**: `feature/<module>`
- **기준 문서**: `docs/specs/<module>.md`, `modules/<module>/README.md`, `CLAUDE.md`
- **최종 업데이트**: YYYY-MM-DD

> Clean Architecture 계층 순서로 단계를 나눈다. 각 Phase는 독립 테스트 가능 단위.
> TDD: 각 Phase에서 Test Writer → Developer → Tester → Refactor 순으로 진행.

---

## 모듈 역할

`docs/specs/<module>.md`의 "모듈 역할" 요약 + 실행 흐름 한 컷.

```
호출자 → 이 모듈의 use_case → port → adapter → 외부
```

---

## Phase 0 — 공유 스키마 의존 확인

- [ ] 이 모듈이 import할 `common_schemas` 타입이 실제 존재/확정인지 확인
- [ ] 없으면 공유 스키마 패키지에 먼저 추가 (별도 PR)
- **완료 기준**: import 가능, 타입 값 고정

## Phase 1 — Domain

- [ ] entities / value_objects (필드·불변식)
- [ ] domain/services (순수 비즈니스 로직, 프레임워크 import 0)
- [ ] domain/ports (ABC 시그니처 확정)
- **완료 기준**: `unit/domain/` 테스트 PASS, mock 불필요

## Phase 2 — Application

- [ ] use_cases (Port mock으로 오케스트레이션 검증)
- **완료 기준**: `unit/application/` 테스트 PASS

## Phase 3 — Adapters

- [ ] domain/ports 구현체 (외부 라이브러리 연동)
- [ ] 재시도/타임아웃/에러 처리
- **완료 기준**: `integration/` 테스트 PASS (실제 외부/DB)

## Phase 4 — 조립 (Composition Root)

- [ ] services/*에서 DI 조립
- [ ] 환경변수 배선 (하드코딩 0)
- **완료 기준**: 서비스 레벨 스모크 통과

## Phase 5 — 테스트/문서 마감

- [ ] 커버리지 점검, lint 통과
- [ ] `modules/<module>/README.md` 공개 API 최신화
- [ ] `docs/specs/<module>.md` 구현 결과와 일치 확인
- **완료 기준**: Review Critical 0, Impact Assessment 완료

---

## 의존성/순서 주의

- 이 모듈보다 먼저 끝나야 하는 모듈: …
- 이 모듈을 기다리는 모듈: …
