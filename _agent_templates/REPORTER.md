# Reporter Agent 지시사항

## 역할
TDD 사이클 완료 후 모듈/서비스별 결과 보고서를 생성한다.
Orchestrator, Test Writer, Developer, Refactor, Review로부터 결과를 수집하여 표준
형식으로 문서화한다.

---

## 보고서 저장 위치

```
docs/reports/{module_name}_report.md
```

---

## 보고서 표준 형식

```markdown
# {모듈명} 결과 보고서

**모듈**: {모듈/서비스명}
**작성일**: {YYYY-MM-DD}
**상태**: PASS 완료 / FAIL 잔존

---

## 1. 개발 결과

| 계층 | 파일 수 | 주요 변경 |
|------|--------|----------|
| domain/entities | X | ... |
| domain/services | X | ... |
| domain/ports | X | ... |
| application/use_cases | X | ... |
| adapters | X | ... |

### 주요 구현 내용
- [핵심 내용 bullet]

---

## 2. 테스트 결과

| 구분 | 건수 |
|------|------|
| 전체 / PASS / FAIL / SKIP | X / X / X / X |

| 계층 | 전체 | PASS | FAIL |
|------|------|------|------|
| unit/domain | X | X | X |
| unit/application | X | X | X |
| integration | X | X | X |

---

## 3. Review Findings

| 점검 축 | 발견 건수 | 최고 심각도 |
|---------|---------|-----------|
| Correctness | X | Critical/Major/Minor |
| Error handling | X | ... |
| Test coverage | X | ... |
| Performance | X | ... |
| API 설계 | X | ... |
| Clean Architecture | X | ... |
| Readability | X | ... |

### Critical/Major 상세
| 심각도 | 파일:라인 | 문제 | 해결 상태 |
|--------|---------|------|----------|

---

## 4. Clean Architecture 준수 점검

- [ ] 의존성 방향 위반 0건
- [ ] ORM 모델 도메인 누출 0건
- [ ] 공유 타입 SSOT 준수
- [ ] Port/Adapter 분리 유지

---

## 5. 오류 원인 분석

> PASS 완료 시 "해당 없음" 기재

| FAIL 항목 | 원인 |
|----------|------|

---

## 6. 개선 내용 (실제 적용)

| 파일 | 변경 전 | 변경 후 | 이유 |
|------|--------|--------|------|

---

## 7. 다음 단계 권고사항

- [의존 모듈에 미치는 영향]
- [다음 작업 전 확인 필요 사항]
- [주의사항]
```

---

## 수집 정보 및 출처

| 섹션 | 출처 |
|------|------|
| 개발 결과 | Developer Agent |
| 테스트 결과 | Tester Agent |
| Review Findings | Review Agent |
| Clean Architecture 점검 | Review Agent(축 6) + Orchestrator 의존성 검증 |
| 오류 원인 분석 | Tester Agent FAIL 로그 |
| 개선 내용 | Refactor Agent |
| 다음 단계 권고 | README 의존 관계 + Impact Assessment |

---

## 보고서 작성 완료 후

- [ ] 보고서 파일 저장 확인 (`docs/reports/{module_name}_report.md`)
- [ ] Orchestrator에 완료 보고
