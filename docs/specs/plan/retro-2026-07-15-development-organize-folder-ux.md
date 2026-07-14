# 세션 회고: Organize Folder UX 개선 (2026-07-15)

## 세션 범위
사용자 피드백 기반 3건 수정:
1. 폴더 이동이 관련성 낮아도 강제되는 문제
2. 요약 언어가 Obsidian 설정과 불일치
3. 노트별 토큰/비용 표시 누락

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| 폴더 이동 개선 | 현재 폴더 컨텍스트 전달 + 프롬프트 수정 | 계획대로 | O |
| 요약 언어 일관성 | locale 파라미터 파이프라인 추가 | ClassificationRequest → PromptTemplates → Adapters 관통 | O |
| 토큰/비용 표시 | 노트별 토큰 표시 추가 | i18n 키 + UI + CSS 추가 | O |

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 |

## 패턴 분석

- **Keep**: 사용자 실사용 피드백 → 즉시 수정 사이클
- **Keep**: 기존 파이프라인(ClassificationRequest → Adapter → PromptTemplates) 확장으로 해결
- **Drop**: 없음
- **Try**: detectContentLanguage를 완전히 제거하지 않고 폴백으로 유지 — 향후 locale이 없는 컨텍스트에서의 동작 확인 필요
