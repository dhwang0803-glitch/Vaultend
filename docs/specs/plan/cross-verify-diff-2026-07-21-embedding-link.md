# 교차 검증 결과 — 임베딩 링크 제안 diff

- **검증 대상**: diff — 임베딩 기반 링크 제안 전체 구현
- **검증 방법**: CLI 직접 실행 (`codex review --base development`)
- **검증 모델**: Codex (gpt-5.6-sol)
- **불일치 항목**: 0건
- **Codex 단독 지적**: 5건 (유효: 5, 오탐: 0)
- **합의 항목**: 해당 없음 (단독 리뷰)
- **오탐률**: 0%

## Codex 지적 및 대응

| # | 심각도 | 지적 내용 | 대응 |
|---|--------|----------|------|
| 1 | P1 | 배치 임베딩에서 privacy rules 미적용 — `note.content`를 직접 전송 | ✅ 수정: `applyContentRedaction()` 적용 |
| 2 | P1 | 대규모 vault에서 단일 API 요청으로 전체 전송 — provider 배치 제한 초과 시 실패 | ✅ 수정: `BATCH_SIZE=100` 분할 처리 |
| 3 | P2 | 캐시 lookup은 전체 content로 해시, 저장 시 truncated body로 해시 — 불일치 | ✅ 수정: 조회/저장 모두 truncated body로 해시 |
| 4 | P2 | `endsWith()` 매칭으로 동명 노트 오매칭 가능 | ✅ 수정: 정확한 path→name 맵 사용 |
| 5 | P2 | 단일 모드 임베딩 토큰 사용량 미반영 | ✅ 수정: `computeEmbeddingLinks()` 반환에 tokenUsage 추가 |

## 검증 후 상태
- 빌드: 통과
- 테스트: 515/515 통과 (golden 제외 — Gemini API 일시 장애)
- 린트: 45 warnings (baseline 동일)
