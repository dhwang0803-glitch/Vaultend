# ADR-0008: AI API 배치 처리 + Rate Limit Circuit Breaker

- **Status**: Accepted
- **Date**: 2026-07-19
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/ai-adapter, area/organize-vault, layer/application

## Context

v0.6.1에서 태그 대소문자 보존 변경 이후 `GenerateOrganizeVaultUseCase`의 제안서 생성이 6분 이상 걸리는 문제가 발생했다. 원인 조사 결과:

### Rate Limit 실측 데이터 (2026-07 기준)

| 프로바이더 | 티어 | RPM | RPD | 입력 단가/1M | 출력 단가/1M |
|-----------|------|-----|-----|-------------|-------------|
| **Gemini 2.5 Flash** | **Free** | **10** | **250** | $0 | $0 |
| Gemini 2.5 Flash | Tier 1 | 300 | 1,500 | $0.15 | $0.60 |
| OpenAI gpt-4o-mini | Free | 미지원 | 미지원 | — | — |
| OpenAI gpt-4o-mini | Tier 1 ($5) | 500 | 10,000 | $0.15 | $0.60 |
| OpenAI embedding-3-small | Free | 100 | 2,000 | $0 | — |
| Anthropic Sonnet | Start | 1,000 | — | $3.00 | $15.00 |
| **Ollama (로컬)** | — | **무제한** | **무제한** | $0 | $0 |

> Gemini Free 티어는 2025년 12월 쿼터 삭감으로 RPM 15→10, RPD 1,500→250으로 대폭 감소. 출처: Google AI Studio 공식 문서, aifreeapi.com, tokenmix.ai

### 문제 분석

`GenerateOrganizeVaultUseCase`의 AI 호출 구조:

| 유형 | 변경 전 방식 | 예: 30개 항목 시 API 호출 수 |
|------|------------|---------------------------|
| Orphan notes | 10개씩 배치 ✅ | 3회 |
| **Broken links** | **1건당 1호출** ❌ | **30회** |
| Missing tags | 10개씩 배치 ✅ | 3회 |
| **Merge candidates** | **1쌍당 1호출** ❌ | **10회** |
| Duplicate tags | AI 불필요 | 0회 |
| Empty notes | AI 불필요 | 0회 |

실제 시나리오: broken link 20개 + orphan 15개 + missing tag 12개 + merge 5쌍 = **29회 API 호출**.
Gemini Free RPM 10 기준: 10번째 요청에서 429 → retry-after 60s × 3회 재시도 = **180초 대기/호출** → 캐스케이드 지연.

### 비용 관점

29회 호출의 비용은 Gemini 유료 기준 ~$0.01, OpenAI 기준 ~$0.01. 비용은 무시할 수준이며, **병목은 RPM 제한**이다.

## Decision

두 가지 메커니즘을 동시에 적용한다:

### 1. Circuit Breaker (AI Adapter 레이어)

429 응답 시 즉시 `RateLimitError`를 throw하고 `rateLimitedUntil` 타임스탬프를 설정한다. 후속 호출은 타임스탬프 만료까지 API 호출 없이 즉시 실패한다.

- **적용 대상**: `GeminiAdapter`, `OpenAIAdapter`, `OpenAICompatAdapter`
- **적용 제외**: `OllamaAdapter` (로컬, rate limit 없음)
- 429 (Rate Limit) → 즉시 실패 + circuit breaker 설정
- 503 (Server Down) → 기존대로 exponential backoff 재시도 유지

**변경 전**: 429 → 3 × 60s 재시도 = 180초 대기 후 실패
**변경 후**: 429 → 즉시 실패 → UseCase의 try/catch fallback으로 넘어감

### 2. 배치 처리 (Application UseCase 레이어)

| 유형 | 변경 전 | 변경 후 | 배치 크기 | 감소율 |
|------|--------|--------|----------|--------|
| Broken links | 1건/1호출 | N건/1호출 | AI_BATCH_SIZE (10) | ~90% |
| Merge candidates | 1쌍/1호출 | N쌍/1호출 | MERGE_BATCH_SIZE (3) | ~60% |

**Merge 배치를 3으로 제한한 이유**: 각 쌍의 입력 콘텐츠가 최대 6,000자(3,000×2)이고, 출력에 전체 병합 문서가 포함되어 JSON 응답이 커진다. 10개 배치 시 입력 60,000자 + 출력 30,000자 → 토큰 한도 초과 위험.

**총합 효과**: 29회 → ~8회 (72% 감소). Gemini Free RPM 10 내에 수용 가능.

## Consequences

### Positive

- Gemini Free 티어에서도 제안서 생성이 정상 작동 (6분+ → 수십 초)
- 429 발생 시 즉시 fallback으로 넘어가므로 UX 개선
- API 호출 횟수 자체가 줄어 비용도 소폭 절감

### Negative / Trade-offs

- 배치 프롬프트가 길어져 단일 호출 실패 시 영향 범위가 커짐 (10개 동시 실패). 기존 per-item fallback으로 완화.
- Merge 배치 출력이 커서 JSON 파싱 실패 확률이 개별 호출보다 높음. try/catch에서 빈 배열 반환으로 graceful degradation.
- Circuit breaker의 `rateLimitedUntil`은 인스턴스 메모리에만 존재 — 플러그인 리로드 시 리셋됨 (의도적: retry-after는 보통 60초이므로 영속화 불필요).

### Follow-ups

- 요청 간 throttle (6초 간격) 추가 — 429 예방 (현재는 429 발생 후 대응만)
- Tag embedding 캐시 영속화 (plan: `smooth-mapping-falcon.md`) — 임베딩 API 호출 자체를 줄임
- RPD 250 소진 감지 + 사용자 알림

## Alternatives Considered

- **Option A: 요청 간 고정 딜레이 (6초)** — RPM 10 기준 안전하지만, 총 소요 시간이 29 × 6 = 174초로 여전히 느림. 배치와 병행하면 유효하나 단독으로는 부족.
- **Option B: 429 시 기존대로 재시도하되 횟수 줄임 (1회)** — 60초 대기 1회로도 캐스케이드. 근본적 해법 아님.
- **Option C: 모든 유형을 하나의 거대 프롬프트로 통합** — 토큰 한도 초과, 파싱 실패 위험, 다른 유형 간 간섭. 기각.
- **Option D: Parallel API 호출 (Promise.all)** — RPM 제한을 더 빨리 소진할 뿐. Free 티어에서는 오히려 악화.

## References

- Gemini API Rate Limits: https://ai.google.dev/gemini-api/docs/rate-limits
- OpenAI Rate Limits: https://developers.openai.com/api/docs/guides/rate-limits
- Anthropic Rate Limits: https://platform.claude.com/docs/en/api/rate-limits.md
- 관련 PR: #143 (MiniSearch vacuum 수정), #TBD (이번 PR)
- 관련 plan: `smooth-mapping-falcon.md` (Tag embedding cache)
