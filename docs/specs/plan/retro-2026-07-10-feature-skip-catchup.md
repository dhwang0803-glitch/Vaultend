# 세션 회고: AI 연동 버그 수정 (2026-07-10)

## 세션 범위

Gemini API 연동 디버깅 + 2건의 버그 수정.

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| Gemini 429 원인 파악 | 코드 내 rate limit 문제 | GCP 무료 tier 크레딧 미충전 + catch-up 불필요 API 호출 | 부분 |
| Quick Ask JSON 파싱 에러 | — (미예상) | Gemini 응답이 ```json 코드블록으로 감싸짐 → JSON.parse 실패 | 추가 발견 |
| catch-up 불필요 호출 수정 | autoApplyInbox 체크 추가 | 1줄 수정 완료 | 일치 |
| JSON 코드블록 파싱 수정 | stripCodeBlock 추가 | 양쪽 어댑터 수정 완료 | 일치 |

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 |
| 변경 파일 | 3개 |
| 변경 규모 | +16 / -3 lines |

## 패턴 분석

- **Keep**: 실환경 테스트에서 발견된 버그를 즉시 수정하는 사이클
- **Keep**: feature 브랜치 분리 후 작업
- **Drop**: 없음
- **Try**: AI 어댑터 통합 테스트 — 실제 API 응답 포맷 검증 (mock만으로는 ```json 래핑 이슈 발견 불가)

## 발견된 사실

1. Gemini API 무료 tier는 GCP 크레딧 최소 16,000원 충전 필요 (limit 0 문제)
2. Gemini는 JSON 응답 요청에도 마크다운 코드블록으로 감싸서 반환
3. autoApplyInbox=false여도 catch-up이 API를 호출하여 토큰 낭비
