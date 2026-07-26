# 세션 회고 — 2026-07-26 development (session 2)

## 세션 범위

사용자 보고 버그 3건 + UX 개선 1건을 단일 세션에서 처리.

| # | 요청 | 결과 |
|---|------|------|
| 1 | 태그 생성 시 교차 언어 중복 (뱀파이어/vampire) | 프롬프트에 태그 언어 규칙 추가 |
| 2 | What's New 모달 본문 영어 하드코딩 | i18n 키 기반으로 전환 (EN/KO) |
| 3 | GPT-5.5에서 organize note 400 에러 | reasoning 모델 json_schema 분기 + temperature/max_tokens 대응 |
| 4 | organize 결과 "관련 노트를 찾지 못해" 메시지 개선 | noTagsReason/noLinksReason 사유 추적 + 맥락별 메시지 분기 |

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|:---:|
| 태그 언어 규칙 | 프롬프트 수정 | 시스템+유저 프롬프트 양쪽 수정 | ✅ |
| What's New i18n | 본문 i18n 전환 | CHANGELOG 구조를 LocaleKey 기반으로 변경 | ✅ |
| GPT-5.5 400 에러 | 모델별 response_format 분기 | OpenAI 공식문서 조사 → reasoning 모델 감지 + json_schema/temperature/max_tokens 분기 | ✅ |
| UX 메시지 개선 | 맥락별 메시지 분기 | OrganizeResult에 사유 필드 추가 + UI 3곳 업데이트 | ✅ |
| Gemini/Ollama 분기 | 필요 시 분기 | 조사 결과 분기 불필요 확인 | ✅ |

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 |

## 패턴 분석

### Keep
- 공식 문서 조사 후 구현: GPT-5.5 문제를 OpenAI docs에서 모델별 지원 현황 확인 후 분기
- 어댑터 내부에서 분기: Port 인터페이스 변경 없이 어댑터에서 모델별 호환성 처리 (Clean Architecture 준수)
- 변경 전 전체 흐름 파악: organize 흐름에서 skip 로직이 어디서 발생하는지 UseCase/UI 모두 확인

### Drop
- 없음

### Try
- reasoning 모델 목록을 하드코딩 대신 설정/메타데이터로 관리하는 방안 검토
