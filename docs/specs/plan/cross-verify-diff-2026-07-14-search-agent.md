# 교차 검증 결과 — 2026-07-14 feature/search-agent

## 검증 대상
- 유형: diff — feature/search-agent 브랜치의 미커밋 변경
- 파일: 8개 (수정 6 + 신규 2)

## 검증 방법
- CLI 직접 실행: `codex exec` (read-only sandbox)
- 검증 모델: Codex (gpt-5.6-sol)

## Codex 종합 판정: FAIL → 수정 후 PASS

## 지적 사항 분류

| # | 심각도 | 지적 | 판정 | 대응 |
|---|--------|------|------|------|
| 1 | HIGH | OpenAI JSON mode는 `{}` 필수, 배열 `[]` 불가 — 키워드 추출 실패 | 유효 | **수정 완료** — `{"keywords": [...]}` 형식으로 변경 |
| 2 | HIGH | 레거시 `embeddingsModel: "text-embedding-3-small"` 이 Gemini에서 실패 | 유효 | **수정 완료** — settings 값 무시, adapter 기본값 강제 |
| 3 | MEDIUM | 프롬프트 예시에 vault-specific 인물명 (윤기범, 이도진) | 유효 | **수정 완료** — 일반적 예시로 교체 |
| 4 | MEDIUM | 키워드 validation 부족 (trim, 빈 문자열, 최대 5개) | 유효 | **수정 완료** — trim/filter/slice(0,5) 추가 |
| 5 | MEDIUM | SyncEmbeddingsUseCase 미연결 | 유효 (재판정) | **수정 완료** — main.ts에 연결, 초기 rebuild + 증분 sync |
| 6 | LOW | API 키 mid-session 미반영 | 유효 (재판정) | **수정 완료** — 항상 adapter 주입, isReady() 동적 판단 |
| 7 | LOW | 벡터 저장소 메타데이터 누락 | 유효/후속 | 차원 불일치 시 similarity 0, 실질적 위험 낮음 → 후속 PR |
| 8 | LOW | 고양이→고양 false positive | 유효/수용 | 원형 토큰 보존됨, fallback 용도 |
| 9 | MEDIUM | buildSearchQuery 테스트 부족 | 유효/후속 | 별도 PR에서 추가 |

## 수정 내역

### 1차 수정 (Codex #1-4)
1. `PromptTemplates.ts`: JSON 배열 → `{"keywords": [...]}` 객체 형식으로 변경 + vault-specific 예시 제거
2. `QuickAskUseCase.ts`: 파싱 로직이 배열과 객체 모두 수용 + trim/filter/slice 검증 추가
3. `AIEmbeddingAdapter.ts`: `settings.embeddingsModel` 참조 완전 제거, adapter 기본값 강제 사용
4. `AIEmbeddingAdapter.test.ts`: model 파라미터 기대값 제거

### 2차 수정 (Codex #5-6, 재판정 후)
5. `SyncEmbeddingsUseCase.ts`: `syncSingle()` 메서드 추가 (단일 노트 증분 동기화)
6. `JsonVectorStoreAdapter.ts`: `isEmpty()` 메서드 추가
7. `main.ts`: SyncEmbeddingsUseCase 배선 + 초기 sync + vault 이벤트 증분 동기화 + 항상 adapter 주입

## 측정
- Codex 단독 유효 지적: 6건 (HIGH 2, MEDIUM 4) — 재판정으로 2건 추가
- 오탐: 0건 (재판정 후 전부 유효 또는 수용으로 재분류)
- 수용/후속: 3건 (#7, #8, #9)
- 수정 완료: 6건 (#1-6)
