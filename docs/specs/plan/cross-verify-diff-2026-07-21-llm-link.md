# 교차 검증 보고서 — 2026-07-21 LLM Link Suggestion

## 검증 정보
- **검증 대상**: diff — feature/llm-link-suggestion 브랜치 전체 변경
- **검증 방법**: Codex CLI 직접 실행 (`codex review --base development`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **오탐률**: 0% (9건 중 유효 9건)

## 종합 판정: FAIL → 수정 후 PASS

Codex가 9건의 유효한 지적을 발견. P1/P2 5건 즉시 수정, P3 3건 수정, P4 1건(통합 테스트)은 후속 세션으로.

## 지적 사항 및 대응

| # | 심각도 | 지적 내용 | 대응 |
|---|--------|----------|------|
| 1 | P1 | 단일 노트 모드에서 LLM 링크 도달 불가 — `cachedNoteSummaries` 없이 호출 시 임베딩 폴백만 실행 | **수정 완료** — `computeLLMLinks`에서 캐시 직접 로드, LLM 우선 → 임베딩 폴백 |
| 2 | P1 | Preview 모드에서 링크 누락 — Pass 2 전체가 `autoApplyOrganize` 조건 내부 | **수정 완료** — 링크 계산을 autoApply 밖으로 이동, vault 쓰기만 조건부 |
| 3 | P2 | Pass 2 vault 쓰기 시 history 미기록 | **수정 완료** — `history.record()` 추가 |
| 4 | P2 | vault 노트 수/maxTokens 무제한 — 대규모 vault에서 토큰 초과 위험 | **수정 완료** — `MAX_VAULT_NOTES_FOR_LINK=200`, `maxTokens` 상한 4000 |
| 5 | P2 | DeepSeek(임베딩 미지원) 환경에서 요약 캐시 저장 불가 | **수정 완료** — 빈 벡터로 캐시 엔트리 생성 |
| 6 | P3 | 배치 링크 선택 토큰 사용량이 결과에 미포함 | **수정 완료** — `OrganizeFolderResult.linkSelectionTokenUsage` 추가 |
| 7 | P3 | `linkSelectionSystemPrompt`에 prompt injection 방어 없음 | **수정 완료** — EN/KO 모두 데이터≠지시 경고 추가 |
| 8 | P4 | 파서가 null/undefined 입력에 취약 | **수정 완료** — `null | undefined` 타입 허용 + early return |
| 9 | P4 | 통합 테스트 미작성 | 후속 세션으로 이관 (수동 Obsidian 테스트로 대체) |

## 수정 파일 목록

- `src/application/usecases/OrganizeNoteUseCase.ts` — P1 #1, #2 수정
- `src/application/usecases/RunInboxProcessUseCase.ts` — P1 #2, P2 #3, #4, #5, P3 #6 수정
- `src/application/PromptTemplates.ts` — P3 #7 수정
- `src/application/utils/parseLinkSelectionResponse.ts` — P4 #8 수정

## 검증 후 빌드/테스트 결과
- `npm run build`: 성공
- `npm run test`: 605개 유닛 테스트 통과 (golden 테스트 제외 — API 키 의존)
