# 교차 검증 결과 — 2026-07-20 feature/enhance-tag-link-suggestions

- **검증 대상**: diff — 태그/링크 제안 고도화 6 Phase
- **검증 방법**: CLI 직접 실행 (`codex exec`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **불일치 항목**: 0건
- **Codex 단독 지적**: 7건 (유효: 7, 오탐: 0)
- **합의 항목**: N/A (독립 검증)

## 지적 사항 및 대응

| # | 심각도 | 파일 | 지적 내용 | 판정 | 대응 |
|---|--------|------|----------|------|------|
| 1 | HIGH | OrganizeNoteUseCase.ts:60 | `selectRelevantTagsByContent`가 redaction 전 raw content로 임베딩 호출 — 개인정보 노출 | 유효 (P1) | **수정 완료** — redaction/truncation을 모든 AI 호출 전으로 이동 |
| 2 | HIGH | OrganizeNoteUseCase.ts:66 | 배치 경로에서 `cachedCanonicalIndex`가 freq-100+relevance-50 분할을 무효화 | 유효 (P2) | **수정 완료** — `selectedTagSet` 필터링으로 AI 프롬프트에 선택된 태그만 전달 |
| 3 | MEDIUM | OrganizeNoteUseCase.ts:202 | `selectRelevantTagsByContent` 임베딩 토큰 미집계 | 유효 | 미수정 — 임베딩 1건(~300 토큰) 미미, 후속 개선 |
| 4 | MEDIUM | OrganizeNoteUseCase.ts:115 | canonical 해석 후 tagDetail 원본 키 미매칭 가능 | 유효 (경미) | 미수정 — 대부분 태그 불변, edge case만 영향 |
| 5 | MEDIUM | 4개 AI 어댑터 | score 0-100 미클램핑, 음수/초과 무방어 | 유효 | **수정 완료** — `Math.min(100, Math.max(0, rawScore))` 추가 |
| 6 | MEDIUM | scoreLinkCandidates.ts:1 | tokenizer에 `/\` 경로 구분자 미포함 | 유효 | **수정 완료** — 정규식에 `/\\` 추가 |
| 7 | LOW | truncateNoteContent.ts:91 | hardCap 0/음수 미방어 | 유효 (경미) | 미수정 — 기본값 15K만 사용, 계약상 경계 오류 |

## 수정 요약

- P1 수정: privacy 보호 — `selectRelevantTagsByContent`에 redacted content 전달
- P2 수정: 배치 태그 최적화 — `selectedTagSet` 기반 canonical index 필터링
- MEDIUM 수정 2건: score 클램핑 + 경로 구분자
- 미수정 3건: 토큰 집계(미미), tagDetail 키 매칭(edge case), hardCap 방어(미사용 경로)

## 오탐률

0/7 = 0% 오탐
