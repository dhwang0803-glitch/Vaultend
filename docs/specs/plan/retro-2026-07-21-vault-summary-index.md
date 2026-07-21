# 세션 회고: Vault Summary Index + Organize Selected

**날짜**: 2026-07-21  
**브랜치**: `feature/maintenance-llm-suggestions`  
**범위**: 요약 캐시 인프라 구축, 배치 요약 인덱싱, Maintenance LLM 코드 제거, Organize selected 버튼

---

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| 1. 요약 캐시 인프라 | SummaryIndexService, BuildSummaryIndexUseCase, PromptTemplates, parseBatchSummaryResponse | 계획대로 구현 | ✅ |
| 2. 배치 요약 인덱싱 | ensureSummaryIndex 게이트, 3개 UseCase 통합 | 계획대로 구현 | ✅ |
| 3. Organize 최적화 | cold-start 해소 (ensureSummaryIndex) | 계획대로 구현 | ✅ |
| 4. Maintenance LLM 제거 + Organize selected | LLM 코드 제거 + UI 버튼 | 계획대로 구현 | ✅ |

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 |
| 신규 파일 | 5 (UseCase 1, Service 1, Parser 1, Spec 1, Test 2) |
| 수정 파일 | 9 |
| 신규 테스트 | 24 (SummaryIndexService 14 + parseBatchSummaryResponse 10) |
| 전체 테스트 통과 | 46 파일 / 649 테스트 |

## 패턴 분석

- **Keep**: 클래스 기반 설계 일관성, Port-based DI 패턴, ensureSummaryIndex 게이트 패턴(DRY)
- **Keep**: 기존 인프라(NoteEmbeddingCachePort.onelineSummary) 재활용하여 별도 저장소 불필요
- **Drop**: 없음
- **Try**: 대규모 vault(5K+ notes)에서 배치 요약 성능 벤치마크

## 아키텍처 결정

1. **기능 역할 분리**: Maintenance = 진단 전용(TF-IDF/키워드 폴백), Organize = AI 보강
2. **Summary-only 캐시 엔트리**: `new Float32Array(0)`으로 벡터 없이 요약만 저장 가능
3. **ensureSummaryIndex 게이트**: 3개 UseCase(OrganizeNote, OrganizeFolder, RunMaintenance)에서 공통 호출
4. **"Organize selected" 브릿지**: Maintenance UI에서 Organize 워크플로우로 직접 전환
