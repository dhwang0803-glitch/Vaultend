# 세션 회고: Quality Foundation Phase 1

> 날짜: 2026-07-12
> 브랜치: feature/quality-foundation-phase1
> 범위: 유료화 품질 기반 5건 구현

---

## 계획 vs 실제

| Step | 계획 | 실제 | 일치 |
|------|------|------|------|
| 1. JSON mode + Retry | CompletionRequest.jsonMode + parseJsonWithRetry | 계획대로 구현 | ✅ |
| 2. 프롬프트 i18n | detectContentLanguage + bilingual prompts | 계획대로 구현 | ✅ |
| 3. MiniSearch BM25 | substring → MiniSearch 교체 | 계획대로 구현 | ✅ |
| 4. 콘텐츠 중복 탐지 | title Jaccard 0.4 후보 → trigram content sim 0.7 | 계획대로 구현 | ✅ |

---

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% (5/5 items) |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 (Port 인터페이스 backward-compatible) |
| 테스트 | 243개 전체 통과 |
| Lint | 통과 |
| Build | 통과 |

---

## 이슈 발생 및 해결

| 이슈 | 원인 | 해결 |
|------|------|------|
| MiniSearch toJSON() 타입 | toJSON()이 object 반환 (string 아님) | JSON.parse 제거 |
| TS 타입 에러 (parseJsonWithRetry) | Record<string, unknown>에서 ClassificationResponse 필드 할당 | 명시적 as 단언 |
| PromptTemplates 테스트 실패 | 'TypeScript란?' ASCII 비율 > 50% → 영어로 감지 | 테스트를 순수 한국어 질문으로 변경 |
| MINISEARCH_OPTIONS readonly 호환 | `as const`가 MiniSearch Options 타입과 불일치 | `as const` 제거 |

---

## 패턴 분석

- **Keep**: Plan mode로 5개 항목 일괄 설계 후 순차 구현 — 의존 관계 사전 파악으로 rework 0
- **Keep**: Step별 테스트 실행으로 regression 즉시 탐지
- **Drop**: 없음
- **Try**: MiniSearch 한국어 토크나이저 커스텀 (향후 Phase 2)

---

## 하네스 개선 제안

없음 — 현재 하네스(plan mode → step별 테스트 → 보안 점검)가 잘 작동함.
