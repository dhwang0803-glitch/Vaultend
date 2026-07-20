# ADR-0011: 임베딩 → LLM 기반 링크 제안 전환

- **Status**: Accepted
- **Date**: 2026-07-21
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/link-suggestion, layer/application, area/embedding

## Context

v0.8.13에서 임베딩 코사인 유사도 기반 링크 제안을 도입했다(ADR-0002). `text-embedding-3-small`로 노트 벡터를 생성하고, 가중 합산(title 0.2 + body 0.8) 후 코사인 유사도 threshold 이상인 노트를 관련 링크로 제안했다.

v0.8.14~0.8.17에 걸쳐 threshold를 0.85 → 0.70 → 0.55로 단계적으로 낮추고, frontmatter stripping, 사용자 threshold slider(0.40~0.80)를 추가했다.

### 실측된 근본 한계

117노트 vault에서 7개 기대 클러스터를 정의하고 threshold별 커버리지를 분석한 결과:

**문제 1: 텍스트 유사도 ≠ 도메인 유사도**

| 기대 연결 | 코사인 유사도 | 판정 |
|-----------|-------------|------|
| Clean Architecture ↔ 마이크로서비스 vs 모놀리스 | 0.23 | 미검출 |
| 효과적인 독서법 ↔ 학습법의 학습(메타 학습) | 0.27 | 미검출 |
| 포모도로 기법 ↔ 수면 최적화 | 0.18 | 미검출 |

이들은 같은 도메인(소프트웨어 엔지니어링, 학습법, 생산성)에 속하지만 본문 텍스트가 완전히 달라 임베딩 유사도가 낮다.

**문제 2: Threshold 딜레마**

| Threshold | 클러스터 커버리지 | 노이즈 |
|-----------|----------------|--------|
| 0.55 | 11~47% (클러스터별) | 낮음 |
| 0.40 | 33~73% | 높음 (임베딩 모델 비교 ↔ 멘탈 모델 모음 = 0.42) |
| 0.30 | 64~100% | 매우 높음 |

어떤 threshold에서도 정밀도(노이즈 없음)와 재현율(기대 연결 포착)을 동시에 달성할 수 없다.

**문제 3: 대안적 보정도 실패**

- Title 가중치 0.2→0.5: 학습 클러스터 title-only 유사도 0.30~0.35로 효과 미미
- 키워드/TF-IDF 부스팅: "모델"이라는 범용 단어가 AI↔인지과학 교차 도메인 오탐을 악화
- 2단계 필터(임베딩→키워드): 키워드 단계에서 동일 문제 재발

### 결론

임베딩은 텍스트 **표면** 유사도를 측정한다. "같은 도메인에 속하는 서로 다른 주제"를 연결하려면 **언어적 추론** 능력이 필요하며, 이는 LLM만이 제공할 수 있다.

## Decision

**링크 제안을 임베딩 코사인 유사도에서 LLM 기반 선택으로 전환한다.**

구체 설계:

1. **Organize 호출 시 1줄 요약 생성**: 기존 `callClassification` 출력 스키마에 `onelineSummary` 필드를 추가하여, 노트별 30자 이내 핵심 요약을 LLM이 생성. 기존 호출에 피기백하므로 추가 API 호출 없음 (+20 output 토큰/노트).

2. **요약 캐시**: `NoteEmbeddingEntry`에 `onelineSummary`를 추가하여 기존 임베딩 캐시에 함께 저장. `contentHash` 기반 변경 감지 재사용.

3. **LLM 링크 선택**: vault 전체 노트 목록(제목 + 캐시된 1줄 요약)을 단일 LLM 호출로 전달. LLM이 도메인 수준 관계를 추론하여 각 대상 노트에 최대 5개 관련 노트를 선택.

4. **2-Pass 배치 구조**: Organize Folder 실행 시 Pass 1(분류+태그+요약 수집) → Pass 2(단일 LLM 링크 선택 호출)로 분리. vault 전체 맥락을 활용하면서 호출 횟수를 1회로 최소화.

5. **임베딩 보존**: 임베딩 벡터와 캐시 인프라는 태그 중복 탐지·Quick Ask 시맨틱 검색에 계속 사용. 링크 제안에서만 역할이 LLM으로 전환.

## Consequences

### Positive

- **도메인 수준 연결 가능**: "Clean Architecture ↔ 마이크로서비스", "효과적인 독서법 ↔ 메타 학습" 등 임베딩으로 불가능했던 관계를 LLM이 추론
- **노이즈 제거**: LLM이 "임베딩 모델 비교 ↔ 멘탈 모델 모음"처럼 단어만 공유하는 무관한 노트를 분별
- **비용 효율**: 기존 80K 토큰 대비 +6,460 토큰(+8.1%) — 절대량 소량
- **기존 인프라 재사용**: 새 API 키·엔드포인트·설정 추가 없음
- **점진적 요약 축적**: Organize 실행마다 요약 캐시가 성장하여 단일 노트 모드 정밀도도 향상

### Negative / Trade-offs

- **비결정성**: 같은 입력에 LLM이 다른 링크를 제안할 수 있음. 임베딩의 결정론적 장점 상실. (완화: "최적"이 아닌 "합리적" 링크면 충분한 유스케이스)
- **첫 실행 제한**: 요약 캐시 없이 첫 Organize Note 실행 시 제목만으로 링크 선택 → 정밀도 낮음. Organize Folder 1회 실행 후 해소.
- **대규모 vault 한계**: 500+노트 시 프롬프트 15,000+토큰. 1,000+노트 시 분할 전략 필요 (후속).
- **배치 모드 2-pass 복잡도**: 기존 1-pass에서 2-pass로 변경. 코드 복잡도 소폭 증가.

### Follow-ups

- 1,000+노트 vault 대응: 클러스터링 또는 임베딩 pre-filter로 LLM 입력 축소
- `linkSuggestionMode` 설정으로 v1(임베딩) 폴백 제공 (마이그레이션 기간)
- 요약 품질 평가 + 프롬프트 튜닝 (실사용 피드백 기반)

## Alternatives Considered

- **Option A: Threshold 추가 하향 (0.30~0.40)** — 재현율 개선이나 노이즈 비율이 수용 불가 수준. 기각.
- **Option B: Title 가중치 상향 (0.3~0.5)** — 실험 결과 효과 미미 (title-only 유사도 자체가 0.30~0.35). 기각.
- **Option C: 키워드/TF-IDF 2단계 필터** — 범용 단어("모델", "전략")가 교차 도메인 오탐을 악화. 기각.
- **Option D: 본문 첫 N글자 truncation + LLM** — 실사용 노트 96%가 heading으로 시작하여 첫 100자에 유의미한 정보 없음. 기각 → LLM 생성 요약으로 대체.
- **Option E: 별도 LLM 요약 호출** — 노트별 추가 API 호출 발생 (48노트 × 1호출 = 48호출). 기각 → 기존 Organize 호출에 피기백.

## References

- ADR-0002: API 기반 임베딩 (BYOK API)
- Spec: `docs/specs/embedding-link-suggestion.md` (v2 개정)
- 실험 데이터: `docs/specs/plan/retro-2026-07-21-*`
- 실측 스크립트: session scratchpad `analyze-uncaught.mjs`, `test-title-weight.mjs`, `check-real-notes.mjs`
