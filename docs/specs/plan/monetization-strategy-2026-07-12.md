# Noluma 유료화 전략 보고서

> 작성일: 2026-07-12
> 상태: 조사 완료 → 품질 개선 진행 중

---

## 1. 시장 조사 요약

### 1.1 Obsidian 유료 플러그인 정책 (2026-05 공식화)

Obsidian이 2026년 5월 "The Future of Obsidian Plugins" 블로그에서 3단계 라벨링 시스템 공식 도입:

| 라벨 | 의미 |
|------|------|
| Free | 무료, 후원 링크만 허용 |
| Optional payments | 선택적 유료 기능 또는 외부 유료 서비스 연동 |
| Paid | 핵심 기능 유료 (무료 체험 허용) |

**허용**: 라이선스 키 게이팅, 외부 결제 처리, 서버 텔레메트리(프라이버시 정책 필수)
**금지**: 동적 광고, 클라이언트 텔레메트리, 코드 난독화, 클로즈드 소스 (신규)
**수수료**: 없음 (Obsidian에 지불할 것 없음)

### 1.2 경쟁 유료 AI 플러그인

| 플러그인 | 월 구독 | 연간 | 평생 | 다운로드 | 핵심 기능 |
|---------|--------|------|------|---------|----------|
| Obsidian Copilot | $14.99 | $139.99 | $349.99 | 150만+ | AI 채팅, RAG, 멀티 모델 |
| Smart Connections | $30 | $299 | Founding (한정판) | 78만+ | 시맨틱 검색, 연관 노트 |
| SystemSculpt AI | $19 | - | $149 | - | AI 채팅, 오디오 전사 |
| Note Companion | $15 | - | - | - | 자동 분류/태깅/이동 |
| Khoj AI | $30 | - | - | - | AI 에이전트, 웹 검색 |

### 1.3 수익 규모 추정

- **구독 AI 플러그인**: 월 $5K~$15K+ (Copilot, Smart Connections)
- **일회성 저가 플러그인**: 거의 $0 (한 개발자 7개 플러그인 총 $35)
- **핵심 인사이트**: 수익 분포가 극단적 양분. SaaS AI만 돈 됨, 나머지 전부 0에 수렴

### 1.4 커뮤니티 가격 감수성

- $5~15/월: 수용 범위
- $15~20/월: 상한선
- 일회성 $35~150: 호응 좋음 (단, 가격이 $79+ 이어야 의미 있는 수익)
- **BYOK 무료 티어는 사실상 필수** (없으면 커뮤니티 저항)
- Obsidian 유저는 구독 극혐, local-first/일회성 선호

### 1.5 Obsidian 시장 규모

| 지표 | 수치 |
|------|------|
| MAU | 150만+ |
| 총 사용자 추정 | 500만~1000만 |
| 커뮤니티 플러그인 수 | 4000~5590개 |
| 총 플러그인 다운로드 | 1.2억+ |
| 노트 앱 시장 규모 | $2.49B (2026, CAGR 13.1%) |

---

## 2. 유료화 가능성 판정

### 2.1 결론: 가능 (조건부)

| 항목 | 판정 |
|------|------|
| 정책적 가능 여부 | **O** — 공식 허용, 수수료 없음 |
| 시장 선례 | **O** — AI 플러그인 5개 이상 유료 운영 중 |
| Noluma 차별점 | **O** — vault 유지보수 자동화는 경쟁자 부재 |
| 현재 품질 수준 | **X** — 핵심 기능 품질이 유료 기준 미달 (아래 상세) |

### 2.2 Noluma 포지셔닝 공백

| Noluma 기능 | Smart Connections | Copilot | Note Companion | 경쟁자 유무 |
|------------|-------------------|---------|----------------|------------|
| Quick Ask (원샷 질의) | X | O (채팅) | X | 있음 |
| Inbox 자동 분류/태깅/이동 | X | X | O | 있음 |
| Vault 유지보수 자동화 | **X** | **X** | **X** | **없음** |
| 유지보수 + 분류 통합 | **X** | **X** | **X** | **없음** |

### 2.3 추천 가격 모델

```
Free (BYOK — 자기 API 키):
  - Quick Ask
  - 기본 유지보수 스캔 (수동 실행)
  - Organize Note (수동, 하루 N회 제한)

Pro — $79~$99 일회성 (BYOK):
  - Inbox 자동화 파이프라인
  - 유지보수 자동 스케줄링
  - 대용량 vault 최적화
  - 무제한 Organize
  - v1.x 모든 업데이트 포함

v2 업그레이드 — 기존 유저 50% 할인:
  - 메이저 기능 추가 시 별도 판매
  - "평생 라이선스"이지만 메이저 버전 한정
```

### 2.4 배포 방식

- 커뮤니티 플러그인 스토어 등재 (라벨: "Optional payments")
- 외부 사이트에서 라이선스 키 판매 (Gumroad 또는 Stripe)
- **오프라인 Ed25519 라이선스 검증** (서버 불필요, local-first 일치)
- 서버 운영비 $0 (BYOK 전용이므로)

---

## 3. 품질 감사 (Quality Audit)

### 3.1 기능별 현재 품질 등급

| 기능 | 현재 수준 | 유료 기준 | 갭 |
|------|----------|----------|-----|
| 깨진 링크 탐지 | A (매우 좋음) | A | 없음 |
| 빈 노트 탐지 | B+ | B+ | 없음 |
| 고아 노트 탐지 | B (태그/임베드 미고려) | A- | 소 |
| UI/UX (모달, 배치 작업, 실행취소) | A- | A- | 없음 |
| 태그 추천 (AI) | B- (파싱 불안정) | A- | **대** |
| 중복 탐지 | D (제목 Jaccard만) | B+ | **Critical** |
| Quick Ask 검색 | D (substring match) | A- | **Critical** |
| 프롬프트 품질 | C+ (한국어 only, few-shot 없음) | B+ | **대** |
| 에러 핸들링 | C (JSON 파싱 실패 시 크래시) | A- | **대** |

### 3.2 Critical 이슈 상세

#### Issue #1: 검색 엔진 (Quick Ask RAG)

**현재**: `JsonSearchIndexAdapter`가 `content.includes(query)` 수준의 substring match
**문제**: 1000+ 노트 vault에서 무관한 컨텍스트가 AI에 전달 → 답변 품질 붕괴
**경쟁자**: Copilot은 벡터 임베딩 + BM25, Smart Connections는 로컬 임베딩
**해결 방안**:
- Phase 1: MiniSearch (JS BM25 라이브러리) 도입 → 즉시 효과
- Phase 2: transformers.js 또는 WASM 기반 로컬 임베딩 → 시맨틱 검색

#### Issue #2: 중복 탐지

**현재**: 파일명 토큰화 → Jaccard similarity >= 0.6
**문제**: "react-guide"와 "react-tutorial"이 중복으로 뜸 (false positive 폭탄)
**해결 방안**:
- Phase 1: 콘텐츠 해시 (simhash 또는 minhash) 추가
- Phase 2: TF-IDF 코사인 유사도로 본문 비교
- 제목 유사도는 "후보 필터링"으로만 사용, 최종 판정은 콘텐츠 기반

#### Issue #3: JSON 구조화 출력 미사용

**현재**: AI 응답을 `JSON.parse(stripCodeBlock(text))`로 파싱 — 실패 시 크래시
**문제**: GPT-4o는 ~5% 확률로 비정규 JSON 반환, Gemini는 더 높음
**해결 방안**:
- OpenAI: `response_format: { type: "json_object" }` 사용
- Gemini: `responseMimeType: "application/json"` + `responseSchema` 사용
- 파싱 실패 시 1회 자동 재시도

### 3.3 High 이슈 상세

#### Issue #4: 프롬프트 다국어화

**현재**: 모든 프롬프트가 한국어 → 영어 노트에 정확도 저하
**해결**: 노트 콘텐츠 언어 감지 (heuristic: ASCII 비율) → 프롬프트 언어 동적 전환

#### Issue #5: 고아 노트 탐지 보완

**현재**: backlink + outgoing link + canvas만 체크
**누락**: `![[embed]]`, 태그 기반 연결, alias 참조
**해결**: embed 참조 + 공유 태그 그룹 고려

---

## 4. 유료화 로드맵

### Phase 1: 품질 기반 확보 (유료화 전 필수)

| # | 작업 | 예상 복잡도 | 영향도 |
|---|------|-----------|--------|
| 1 | MiniSearch 기반 BM25 검색 엔진 교체 | Medium | Quick Ask 품질 2~3배↑ |
| 2 | 중복 탐지에 콘텐츠 simhash 추가 | Medium | False positive 90%↓ |
| 3 | OpenAI/Gemini JSON mode 적용 | Low | 크래시 제거 |
| 4 | 프롬프트 영어/한국어 동적 전환 | Low | 글로벌 유저 확보 |
| 5 | AI 응답 파싱 실패 retry (1회) | Low | 안정성↑ |

### Phase 2: 차별화 기능 (유료 가치 생성)

| # | 작업 | 예상 복잡도 | 차별점 |
|---|------|-----------|--------|
| 6 | 로컬 임베딩 (transformers.js) | High | "서버 없는 시맨틱 검색" — 프라이버시 강점 |
| 7 | 자동 유지보수 스케줄링 + 변경 추적 | Medium | "set-and-forget 유지보수" |
| 8 | Inbox 파이프라인 정확도 벤치마크 (90%+ 목표) | Medium | 신뢰 구축 |
| 9 | TF-IDF 콘텐츠 중복 탐지 | Medium | 진짜 중복만 잡음 |

### Phase 3: 유료화 실행

| # | 작업 | 설명 |
|---|------|------|
| 10 | 100-노트 벤치마크 vault 구축 | 태그 정확도, 중복 precision/recall, 응답시간 측정 |
| 11 | Copilot/Smart Connections 대비 A/B 비교 공개 | 랜딩페이지 자료 |
| 12 | Ed25519 오프라인 라이선스 시스템 구현 | 서버 비용 $0 유지 |
| 13 | Gumroad/Stripe 결제 페이지 | 라이선스 키 발급 |
| 14 | 커뮤니티 스토어 라벨 변경 ("Optional payments") | manifest.json `fundingUrl` 추가 |

---

## 5. 리스크와 대응

| 리스크 | 확률 | 대응 |
|--------|------|------|
| 커뮤니티 저항 ("왜 유료?") | 중 | BYOK 무료 티어 유지, 유지보수 기능은 무료로 잔존 |
| Note Companion이 유지보수 기능 추가 | 중 | 로컬 임베딩 + 프라이버시 차별화로 대응 |
| 일회성 구매 후 수익 정체 | 높음 | 메이저 버전 업그레이드 모델로 장기 수익 확보 |
| LLM API 비용 상승 | 낮음 | BYOK라 유저 부담, 우리 리스크 아님 |
| Obsidian이 유료 플러그인 정책 변경 | 낮음 | 2026-05에 공식화했으므로 단기 변경 가능성 극낮음 |

---

## 6. 성공 기준 (유료 전환 전 달성 필수)

- [ ] Quick Ask: 10개 질문 대비 관련 컨텍스트 적중률 80%+ (현재 추정 30~40%)
- [ ] 중복 탐지: precision 85%+ (현재 추정 20~30%)
- [ ] 태그 추천: 기존 태그 재사용률 90%+ (현재 추정 70~80%)
- [ ] JSON 파싱 성공률: 99.5%+ (현재 추정 95%)
- [ ] Inbox 자동 분류: 올바른 폴더 배치율 85%+ (미측정)
- [ ] 100-노트 vault에서 전체 파이프라인 무장애 완주

---

## 참고 소스

- Obsidian 공식 블로그: https://obsidian.md/blog/future-of-plugins/
- 개발자 정책: https://docs.obsidian.md/Developer+policies
- Copilot 가격: https://www.obsidiancopilot.com/en/pricing
- Smart Connections: https://smartconnections.app/pro-plugins/
- SystemSculpt: https://systemsculpt.com/pricing
- Note Companion: https://www.notecompanion.ai/
- Obsidian 포럼 유료 플러그인 논의: https://forum.obsidian.md/t/paid-plugin-market-and-how-to-solve-unmaintained-plugins/109137
- 인디해커 유료 플러그인 후기: https://www.indiehackers.com/post/i-shipped-a-paid-obsidian-plugin-with-no-server-no-subscription-and-offline-licensing-0a87e1f23c
