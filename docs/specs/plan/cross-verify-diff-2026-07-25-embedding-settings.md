# 교차 검증 보고서 — 2026-07-25 임베딩 모델 설정 드롭다운

## 검증 대상
- 유형: diff (임베딩 모델 설정 UI + 에러 Notice)
- 파일: `PluginSettingTab.ts`, `main.ts`, `AIEmbeddingAdapter.ts`, `en.ts`, `ko.ts`

## 검증 방법
- CLI 직접 실행: `codex exec --full-auto` (ESLint + Build + 코드 리뷰)
- 검증 모델: Codex (gpt-5.6-sol)

## 실행 결과
- ESLint: **PASS** (위반 0건)
- Build: FAIL (Codex sandbox 파일 접근 제한 — **오탐**, 로컬 빌드 정상 통과)
- TypeScript: PASS (`tsc -noEmit -skipLibCheck` 통과)

## Codex 지적 사항

| # | 심각도 | 지적 내용 | 유효/오탐 | 대응 |
|---|--------|----------|----------|------|
| 1 | P2-HIGH | `AIEmbeddingAdapter`에서 `callEmbedding` 호출 시 `model` 미전달 — 설정에서 선택한 모델이 실제 API 요청에 반영되지 않음 | **유효** | ✅ 수정 — `setModel()` 추가, 모든 `callEmbedding` 호출에 `model` 전달 |
| 2 | P2-HIGH | provider 변경 시 `embeddingsModel` 리셋 안 됨 — OpenAI 모델명이 Gemini에 전달될 수 있음 | **유효** | ✅ 수정 — provider 변경 시 `embeddingsModel`을 새 provider 기본값으로 초기화 |
| 3 | P3-MEDIUM | `initialize()` 예외 삼킴 — Notice에 실제 에러 대신 provider/model 문자열만 표시 | **유효** | ✅ 수정 — 에러를 throw, 상위에서 `localizeError(err)` 사용 |
| 4 | Build FAIL | esbuild 경로 접근 거부 | **오탐** | Codex sandbox 제한. 로컬 빌드 정상 |

## 종합
- 오탐률: 25% (1/4)
- 유효 지적: 3건 전부 수정 완료
- 수정 후 빌드/린트/테스트: 모두 통과 (42 files, 599 tests)
