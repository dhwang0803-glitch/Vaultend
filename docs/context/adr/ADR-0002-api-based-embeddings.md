# ADR-0002: API 기반 임베딩 (로컬 transformers.js 대신 BYOK API)

- **Status**: Accepted
- **Date**: 2026-07-12
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/embedding, layer/adapter, area/search

## Context

Phase 2에서 시맨틱 검색을 위해 벡터 임베딩이 필요했다. 초기 계획은 `@huggingface/transformers`로 로컬 ONNX 모델(`Xenova/all-MiniLM-L6-v2`, 384-dim)을 Obsidian 내에서 실행하는 것이었다.

문제:
1. WASM 런타임 (~23MB ONNX 모델 + ~100MB 메모리)이 Obsidian 환경에서 불안정할 수 있음
2. 사용자가 `@huggingface/transformers` 패키지를 별도 설치해야 함 (배포 복잡도 증가)
3. Quick Ask/Organize Note가 이미 AI API로 텍스트를 전송하므로, 프라이버시 우려가 추가되지 않음
4. 플러그인은 이미 BYOK(Bring Your Own Key) 모델이므로 사용자 API 키가 존재함

## Decision

**기존 BYOK API 키를 활용하여 AI 제공자(OpenAI/Gemini)의 임베딩 엔드포인트를 호출한다.**

- `AIProviderPort`에 `callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse>` 추가
- OpenAI: `POST /v1/embeddings` (model: `text-embedding-3-small`, 1536-dim)
- Gemini: `POST /v1beta/models/{model}:batchEmbedContents` (model: `text-embedding-004`, 768-dim)
- `AIEmbeddingAdapter`가 `EmbeddingPort`를 구현하며 `AIProviderPort.callEmbedding()`에 위임
- 로컬 `TransformersEmbeddingAdapter` 제거

## Consequences

### Positive
- 배포 단순화: 추가 패키지/WASM 파일 불필요
- 높은 품질: API 모델(1536-dim)이 로컬 경량 모델(384-dim)보다 정확
- 기존 retry/rate-limit 인프라 재사용
- 메모리 사용량 절감 (ONNX 런타임 불필요)

### Negative / Trade-offs
- 오프라인 사용 불가 (네트워크 필수)
- 임베딩 API 호출 비용 발생 (OpenAI: $0.02/1M tokens — 매우 저렴)
- 벡터 차원이 provider별로 다름 (OpenAI 1536, Gemini 768) → provider 변경 시 전체 재인덱싱 필요

### Follow-ups
- provider 변경 감지 → 자동 `vectorStore.clear()` + 재인덱싱 로직 (미구현, 추후)
- Settings UI에 임베딩 활성화 토글 추가

## Alternatives Considered

- **Option A: 로컬 transformers.js** — 오프라인 지원, 프라이버시 최대. 기각: 배포 복잡도, WASM 불안정, 이미 텍스트가 API로 전송되므로 프라이버시 이점 없음.
- **Option B: 별도 임베딩 API 키** — 임베딩 전용 키를 별도 설정. 기각: UX 복잡도 증가, 기존 키로 동일 엔드포인트 접근 가능.

## References

- PR #49: feat: Phase 2 차별화 기능
- OpenAI Embeddings API: https://platform.openai.com/docs/guides/embeddings
- Gemini Embedding API: https://ai.google.dev/gemini-api/docs/embeddings
