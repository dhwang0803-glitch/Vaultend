# 실환경 임베딩 벤치마크 가이드

> Obsidian vault에서 BM25 / Embedding / Hybrid Search 성능을 측정하는 가이드.  
> Obsidian 없이 CLI로 독립 실행 가능.

---

## 1. 사전 요구사항

```bash
# Gemini API Key 환경변수 설정
set GEMINI_API_KEY=your-api-key-here    # Windows
export GEMINI_API_KEY=your-api-key-here  # Mac/Linux

# 프로젝트 빌드 확인
npm run build
```

---

## 2. 벤치마크 도구 구성

| 도구 | 파일 | 용도 |
|------|------|------|
| Golden Set Benchmark | `src/benchmark/vault-benchmark.ts` | 골든셋 47 문서 기반 검색 정확도 측정 |
| Embedding Benchmark | `src/benchmark/embedding-benchmark.ts` | 임베딩 모델 비교 (속도/정확도) |
| Scale Test | `src/benchmark/scale-test.ts` | 대규모 vault 성능 측정 (5K+ docs) |

---

## 3. 골든셋 벤치마크 실행

### 3-1. BM25-only (API 불필요)

```bash
npx tsx src/benchmark/vault-benchmark.ts --vault "C:\Users\daewo\obsidian\Vaultend\Inbox"
```

**기대 결과:**
- Easy (keyword) MRR: 90%+
- Medium (paraphrase) MRR: 60~70%
- Hard (semantic) MRR: 30~50%

### 3-2. Hybrid (BM25 + Embedding)

```bash
npx tsx src/benchmark/vault-benchmark.ts \
  --vault "C:\Users\daewo\obsidian\Vaultend\Inbox" \
  --embed \
  --provider gemini \
  --model gemini-embedding-001 \
  --weight 2.0 \
  --k 60
```

**기대 결과 (v0.3.11 기준):**

| 난이도 | BM25 MRR | Hybrid MRR | 개선 |
|--------|----------|------------|------|
| Easy | ~100% | 100% | - |
| Medium | ~70% | 100% | +30%p |
| Hard | ~40% | 100% | +60%p |
| **Overall** | ~70% | **100%** | +30%p |

### 3-3. RRF Weight Sweep (최적 파라미터 탐색)

```bash
npx tsx src/benchmark/vault-benchmark.ts \
  --vault "C:\Users\daewo\obsidian\Vaultend\Inbox" \
  --embed \
  --provider gemini \
  --sweep
```

**출력:**
- k × weight 조합별 MRR 테이블 (24개 조합)
- 최적 config 추천 (기본: k=60, weight=2.0)
- 결과 파일: `src/benchmark/rrf-sweep-results.json`

**합격 기준:**
- Overall MRR >= 95%
- Hard MRR >= 90% (★ 마크 조건)

---

## 4. 임베딩 모델 비교

```bash
npx tsx src/benchmark/embedding-benchmark.ts
```

**비교 대상:**
- `gemini-embedding-001` (기본, 768-dim)
- `text-embedding-004` (레거시)

**측정 항목:**

| 지표 | 설명 | 합격 기준 |
|------|------|----------|
| MRR@5 | 상위 5개 내 정답 역순위 평균 | >= 90% |
| P@1 | Top-1 정확도 | >= 80% |
| Latency (ms) | 단일 쿼리 임베딩 시간 | < 500ms |
| Throughput | 배치 처리 속도 (docs/sec) | >= 10 |

---

## 5. 대규모 Vault 스케일 테스트

```bash
npx tsx src/benchmark/scale-test.ts --docs 1000
npx tsx src/benchmark/scale-test.ts --docs 5000
```

**측정 항목:**

| 지표 | 1K docs | 5K docs | 합격 기준 |
|------|---------|---------|----------|
| BM25 Search P50 | < 5ms | < 10ms | < 50ms |
| BM25 Search P95 | < 10ms | < 20ms | < 100ms |
| Vector Search P50 | < 3ms | < 7ms | < 50ms |
| Vector Search P95 | < 5ms | < 15ms | < 100ms |
| Hybrid (RRF) P50 | < 8ms | < 15ms | < 100ms |
| Hybrid (RRF) P95 | < 15ms | < 30ms | < 200ms |
| Memory (vectors) | < 50MB | < 200MB | < 500MB |

**기존 벤치 결과 (PR #52 기준):**
- 5000 docs Hybrid P95 = 6.25ms ✅

---

## 6. 실환경 통합 성능 테스트

Obsidian 플러그인 내에서 실행하는 테스트 (콘솔 로그로 확인).

### 6-1. 임베딩 초기화 시간

| 테스트 | 방법 | 합격 기준 |
|--------|------|----------|
| Cold start | 플러그인 로드 후 콘솔에서 "embeddings initialized" 시간 확인 | < 5초 |
| Warm start (캐시) | Obsidian 재시작 후 vector store load 시간 | < 2초 |

### 6-2. Quick Ask 응답 시간

| 테스트 | 방법 | 합격 기준 |
|--------|------|----------|
| BM25-only | Embeddings Disabled → Quick Ask | < 3초 (AI 응답 제외 검색부분) |
| Hybrid | Embeddings Enabled → Quick Ask | < 4초 (AI 응답 제외 검색부분) |

**측정 방법:** Developer Console (Ctrl+Shift+I) → 타임스탬프 확인

### 6-3. Maintenance Scan 시간

| Vault 크기 | 합격 기준 |
|------------|----------|
| 50 notes | < 2초 |
| 200 notes | < 5초 |
| 1000 notes | < 15초 |

### 6-4. 메모리 사용량

| 항목 | 측정 | 합격 기준 |
|------|------|----------|
| 플러그인 로드 후 idle | Task Manager 또는 DevTools Memory | < 100MB 추가 |
| 50 notes 임베딩 후 | DevTools Heap Snapshot | < 150MB 추가 |
| 200 notes 임베딩 후 | DevTools Heap Snapshot | < 300MB 추가 |

---

## 7. 검색 품질 정성 평가

골든셋 외에 실제 vault 노트로 수동 평가.

### 7-1. 시맨틱 검색 품질

아래 쿼리들을 Quick Ask에서 실행하고, 참조된 context가 적절한지 판단:

| # | 쿼리 (의미적) | 기대되는 관련 노트 | PASS/FAIL |
|---|--------------|-------------------|-----------|
| 1 | "부수효과 없이 데이터 변환하는 패턴" | 순수 함수, FP 관련 노트 | |
| 2 | "컴포넌트 간 데이터 전달 방법" | Props, Context, State management 노트 | |
| 3 | "비동기 작업 에러 처리" | try/catch, Promise, async/await 노트 | |
| 4 | "코드 재사용을 위한 추상화" | Hooks, HOC, 상속 vs 합성 노트 | |
| 5 | "앱 성능 개선 전략" | Memoization, lazy loading, 최적화 노트 | |

### 7-2. BM25 vs Hybrid 비교

동일 쿼리를 BM25-only (embeddings off)와 Hybrid (embeddings on)로 실행하여 비교:

| 쿼리 | BM25 context 노트 | Hybrid context 노트 | Hybrid 추가분 |
|------|-------------------|--------------------|-----------| 
| (쿼리 1) | | | |
| (쿼리 2) | | | |

**합격 기준:** Hybrid가 BM25 대비 의미적으로 관련된 추가 노트를 1개 이상 포함

---

## 8. 결과 기록 템플릿

```markdown
## 벤치마크 결과 (날짜: YYYY-MM-DD)

### 환경
- OS: Windows 11 / macOS XX
- Obsidian: v1.X.X
- Plugin: v0.3.XX
- Vault: XX notes
- AI Provider: Gemini / OpenAI
- Embedding Model: gemini-embedding-001

### Golden Set 결과
| 모드 | Easy MRR | Medium MRR | Hard MRR | Overall MRR |
|------|----------|------------|----------|-------------|
| BM25 | | | | |
| Embedding | | | | |
| Hybrid | | | | |

### Scale Test 결과
| Docs | BM25 P95 | Vector P95 | Hybrid P95 |
|------|----------|------------|------------|
| 1000 | | | |
| 5000 | | | |

### 실환경 체감
| 항목 | 결과 | 비고 |
|------|------|------|
| Quick Ask 체감 속도 | 빠름/보통/느림 | |
| 검색 정확도 체감 | 좋음/보통/부족 | |
| 메모리 안정성 | 안정/불안정 | |

### 이슈
- (발견된 문제 기록)
```

---

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| "Embedding initialization failed" | API 키 미설정 또는 만료 | Settings에서 키 확인 |
| Hybrid 결과가 BM25과 동일 | 임베딩 미초기화 | Obsidian 재시작 후 5초 대기 |
| "ECONNREFUSED" | 네트워크 문제 | 인터넷 연결 확인 |
| sweep 결과 파일 없음 | --sweep 플래그 누락 | 명령어에 --sweep 추가 |
| Scale test OOM | docs 수 과다 | --docs 1000으로 시작 |
