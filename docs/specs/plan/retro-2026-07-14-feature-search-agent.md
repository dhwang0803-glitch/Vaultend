# 세션 회고 — 2026-07-14 feature/search-agent

## 세션 요약
- 브랜치: feature/search-agent
- 커밋: 0건 (PR 생성 시 첫 커밋)
- 변경 파일: 8개 (수정 6 + 신규 2)
- 교차 검증: 대기

## 계획 vs 실제

이 세션은 명시적 계획 파일 없이 사용자와 대화형으로 진행됨. 사용자가 Quick Ask 검색 실패 사례(한국어 조사 문제)를 보고하면서 시작, 점진적으로 솔루션 아키텍처를 확장.

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| 근본 원인 분석 | 사용자 보고 → 원인 파악 | MiniSearch prefix:true + 한국어 조사 교착 확인 | ✅ |
| Korean particle strip | offline fallback | 30개 패턴 + 9개 테스트 구현 | ✅ |
| AI keyword extraction | 검색 전 AI로 키워드 추출 | buildSearchQuery() + PromptTemplates 추가 | ✅ |
| Embeddings 자동 활성화 | API 키 있으면 자동 | embeddingsEnabled → aiApiKey 기반으로 전환 | ✅ |
| Embedding 모델 자동 선택 | provider별 기본 모델 | adapter fallback 활용 (|| undefined) | ✅ |
| Settings UI 정리 | 내부 설정 숨기기 | Search (Advanced) 섹션 제거 | ✅ |
| Function calling agent | 미래 과제로 논의 | 미구현 (의도적 — 별도 feature로) | ✅ 계획대로 미구현 |

계획 이행률: 100% (논의된 모든 항목 완료, function calling은 의도적 후속 과제)

## 패턴 분석

### Keep (유지)
- **사용자 실사례 기반 디버깅**: 실제 Quick Ask 결과 파일을 읽어서 근본 원인을 정확히 파악
- **계층적 솔루션 설계**: offline fallback(particle strip) → AI extraction → semantic search(embeddings)로 3단 방어
- **adapter 자체 default 활용**: 각 adapter가 이미 갖고 있는 `??` fallback을 활용하여 코드 중복 없이 모델 자동 선택

### Drop (중단)
- **디버그 로깅을 코드에 남기는 것**: 이전 세션에서 [KM-DEBUG] 로깅을 추가했다가 Codex에서 privacy 위반 P2 지적받음. 이번 세션에서 모두 제거

### Try (시도)
- **Function calling search agent**: 다음 세션에서 Gemini function calling으로 AI가 search_vault() 도구를 반복 호출하는 구조 시도
- **Embedding 초기화 실패 시 사용자 알림**: 현재는 console.error만 — Notice로 알려주면 UX 개선

## 하네스 개선 제안

없음 — 이번 세션에서 하네스 관련 문제 미발생.

## 측정 지표
- 계획 이행률: 100%
- 자기 편향 발생: 0회
- 아키텍처 드리프트: 없음
