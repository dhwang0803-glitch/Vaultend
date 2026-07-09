# 세션 회고: runtime-fixes-quickask-modes

**날짜**: 2026-07-10
**브랜치**: `feature/runtime-fixes-quickask-modes`
**범위**: v0.2.1 실환경 QA에서 발견된 런타임 버그 수정 + Quick Ask 저장 모드 개선

---

## 계획 vs 실제

| Phase | 계획 | 실제 | 일치 |
|-------|------|------|------|
| 런타임 버그 진단 | Gemini 429 원인 파악 | GCP 크레딧 문제 + catch-up 불필요 호출 발견 | ✅ |
| AI 어댑터 재시도 | 429/503 재시도 로직 추가 | requestWithRetry + stripCodeBlock 구현 완료 | ✅ |
| ensureFolderExists | "Folder already exists" 수정 | try-catch 래핑 완료 | ✅ |
| Quick Ask 덮어쓰기 방지 | 타임스탬프 파일명 도입 | timestamp + daily-note 듀얼 모드 구현 | ✅ (확장) |
| Daily Note 사이즈 분할 | 한계 용량 초과 시 자동 분할 | findAvailableDailyNote 루프 구현 | ✅ |
| 설정 UI | Quick Ask 저장 모드 UI | PluginSettingTab에 섹션 추가 | ✅ |

## 측정 지표

| 지표 | 값 |
|------|-----|
| 계획 이행률 | 100% |
| 자기 편향 발생 | 0회 |
| 아키텍처 드리프트 | 없음 |
| 변경 파일 수 | 10 |
| 테스트 결과 | 213/213 통과 |

## 패턴 분석

- **Keep**: 실환경 QA 기반 버그 발견 → 즉시 수정 사이클이 효과적
- **Keep**: Obsidian requestUrl 예외 동작(non-200 시 throw) 파악 후 try-catch 기반 재시도 설계
- **Drop**: 없음
- **Try**: 재시도 로직 테스트에서 실제 sleep 대기 대신 fake timer 사용 고려 (14초 소요 절감)

## 주요 학습

1. **Gemini API 무료 티어 함정**: GCP에 최소 16,000원 크레딧 없으면 limit=0으로 모든 요청 429
2. **Gemini JSON 래핑**: `\`\`\`json` 코드블록으로 JSON을 감싸서 반환 — stripCodeBlock 필수
3. **Obsidian createFolder 레이스**: getAbstractFileByPath 캐시 타이밍 문제로 이미 존재하는 폴더에 createFolder 시 예외 발생
4. **requestUrl 예외 동작**: non-200 응답에서 예외를 throw하므로 status 체크 코드가 도달 불가 — try-catch 필수
