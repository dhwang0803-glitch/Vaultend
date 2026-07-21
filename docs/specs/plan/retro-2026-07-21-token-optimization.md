# 세션 회고 — 2026-07-21 development (토큰 최적화 + 스마트 필터링)

## 세션 요약
- 브랜치: development
- 변경 파일: 10개
- 교차 검증: 실행 예정

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| Pass 1 tag-only 경량화 | classification prompt에서 summary/confidence/category 제거, maxTokens 1000→400 | 계획대로 완료, 4개 어댑터 모두 적용 | ✅ |
| Pass 2 배치 최적화 | 개별 호출 → 3 targets/call 배치 | 계획대로 완료, maxTokens 동적 계산 | ✅ |
| 비용 집계 수정 | — | 추가 발견: Pass 2 estimatedCostUsd가 0으로 하드코딩 → 실제 값 반영 | 계획 외 |
| 스마트 필터링 | — | 커뮤니티 리서치 기반으로 추가 구현 (50 단어, 3 outgoing links, Related Notes) | 계획 외 |

## 패턴 분석

### Keep (유지)
- 커뮤니티 리서치 기반 의사결정: fleeting note 기준과 outgoing link 기준을 실제 vault 데이터로 뒷받침
- 사용자와 함께 실시간 테스트 → 즉시 피드백 → 수정 사이클이 효과적

### Drop (중단)
- frontmatter 포함 단어 수 계산: 초기에 stripFrontmatter 없이 구현해서 필터가 작동하지 않음. 노트 내용 처리 시 항상 frontmatter 제거 우선

### Try (시도)
- 대규모 vault (1,000+) 환경에서 스마트 필터링 효과 검증

## 측정 지표
- 계획 이행률: 2/2 (100%) + 계획 외 2건
- 자기 편향 발생: 0회
- 아키텍처 드리프트: 없음
