# 교차 검증 결과 — 2026-07-20 link-scoring-prompt-cache

- **검증 대상**: diff — "미분류" 뱃지 제거 + 링크 스코어링 강화 + 프롬프트 캐싱
- **검증 방법**: CLI 직접 실행 (`codex review --base development`)
- **검증 모델**: Codex
- **불일치 항목**: 0건
- **Codex 단독 지적**: 6건 (유효: 5, 미수정(기존코드): 1)
- **합의 항목**: N/A (독립 검증)

## 지적 사항 및 대응

| # | 심각도 | 파일 | 지적 내용 | 판정 | 대응 |
|---|--------|------|----------|------|------|
| 1 | HIGH | PromptTemplates.ts | 시스템 프롬프트에 비신뢰 데이터(태그/노트명) 삽입 → 프롬프트 인젝션 위험 | 유효 (P2) | **수정 완료** — 태그/노트 목록을 유저 메시지로 이동, 시스템 프롬프트는 순수 정적 + 인젝션 방어 지시 추가 |
| 2 | MEDIUM | PromptTemplates.ts | 캐싱 효과 없음 — existingTags/availableNotes가 노트마다 달라 system prompt 비동일 | 유효 | **수정 완료** — #1 수정으로 해소. system prompt 순수 정적, 유저 메시지 prefix(태그+노트)가 배치 내 동일 |
| 3 | MEDIUM | scoreLinkCandidates.ts | 한국어 조사 스트리핑이 `전문가→전문` 같은 오탐 발생 | 유효 | **수정 완료** — `가`, `이` 제거 (명사 어미와 혼동 빈도 높음) |
| 4 | MEDIUM | PromptTemplates.ts | 빈 노트에 "정확히 3개 태그 생성" 강제 → 할루시네이션 위험 | 유효 (기존 코드) | 미수정 — 이번 변경에서 도입된 것 아님, 후속 이슈로 분리 |
| 5 | MEDIUM | AIProviderPort.ts, OrganizeModels.ts | category 필드가 UI/프롬프트에서 제거되었으나 인터페이스에 필수로 남음 | 유효 | **수정 완료** — `category`, `classifiedCategory` 모두 optional로 변경 |
| 6 | LOW | PromptTemplates.ts | deprecated `classifyAndTag`가 인자(existingTags/availableNotes) 무시 | 유효 | **수정 완료** — deprecated 메서드 완전 제거 |

## 수정 요약

- P2 수정 1건: 시스템 프롬프트 → 순수 정적, 인젝션 방어 지시 추가
- MEDIUM 수정 3건: 캐싱 구조 개선, 한국어 조사 오탐 수정, category optional 변경
- LOW 수정 1건: deprecated 메서드 제거
- 미수정 1건: 빈 노트 태그 강제 (기존 코드, 후속 이슈)

## 오탐률

0/6 = 0% 오탐
