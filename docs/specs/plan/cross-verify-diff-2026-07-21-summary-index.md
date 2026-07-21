# 교차 검증 보고서: Summary Index + Organize Selected

**날짜**: 2026-07-21  
**브랜치**: `feature/maintenance-llm-suggestions`  
**검증 방법**: CLI 직접 실행 (`codex review --base development`)  
**검증 모델**: Codex (gpt-5.6-sol)

---

## 검증 결과 요약

- **불일치 항목**: 0건
- **Codex 단독 지적**: 5건 (유효 5건, 오탐 0건)
- **합의 항목**: 0건

---

## Codex 단독 지적 (모두 유효 — 즉시 수정 완료)

| # | 심각도 | 파일 | 지적 내용 | 대응 |
|---|--------|------|----------|------|
| 1 | P1 | BuildSummaryIndexUseCase.ts | privacy redaction 미적용 — 원본 content를 AI에 전송 | ✅ 수정: `applyContentRedaction()` 적용 |
| 2 | P1 | OrganizeNoteUseCase.ts:562-564 | `some()` gate로 인해 신규/변경 노트 인덱싱 누락 | ✅ 수정: gate 제거, `execute()` 자체 증분 로직에 위임 |
| 3 | P1 | RunMaintenanceUseCase.ts:42 | ensureSummaryIndex 토큰 사용량 미보고 | ✅ 수정: `TokenUsage` 반환 + `MaintenancePlan.tokenUsage` 전파 |
| 4 | P2 | main.ts:387-393 | DynamicAIAdapter 항상 존재 → AI 미설정 시 불필요한 스캔 | ✅ 수정: `hasAIProviderConfig()` 게이트 추가 |
| 5 | P2 | OrganizeNoteUseCase.ts:559-561 | Folder 루프에서 반복 `load()` → dirty 캐시 데이터 손실 | ✅ 수정: context 제공 시 ensureSummaryIndex 스킵 |

---

## 사실 확인 결과

### P1-1: Privacy redaction 미적용
- **확인**: `BuildSummaryIndexUseCase`는 `note.content`를 직접 사용 (line 56)
- **비교**: `OrganizeNoteUseCase` (line 67), `RunInboxProcessUseCase` (line 120)는 `applyContentRedaction()` 적용
- **판정**: 유효 — privacy bypass 존재

### P1-2: 증분 인덱싱 미동작
- **확인**: `some(e => e.onelineSummary)` — 1개라도 요약 있으면 전체 스킵
- **확인**: `BuildSummaryIndexUseCase.execute()` 내부에 contentHash 기반 증분 로직 존재
- **판정**: 유효 — gate가 불필요하게 조기 종료

### P1-3: 토큰 사용량 미보고
- **확인**: `ensureSummaryIndex()` 반환 타입 `void` — `SummaryIndexResult.tokenUsage` 폐기
- **확인**: `MaintenancePlan.tokenUsage` 필드 존재하나 미설정
- **판정**: 유효

### P2-1: AI 미설정 시 불필요한 인스턴스 생성
- **확인**: `this.aiAdapter = new DynamicAIAdapter(...)` — 항상 truthy
- **확인**: `hasAIProviderConfig()` 별도 존재 (line 265)
- **판정**: 유효

### P2-2: Folder 루프 내 반복 load()
- **확인**: `RunInboxProcessUseCase`가 각 노트에 `organizeNote.execute(notePath, autoApply, context)` 호출
- **확인**: `OrganizeNoteUseCase.ensureSummaryIndex()` → `load()` 호출
- **확인**: Folder 루프 중 in-memory 캐시에 쓴 summary가 다음 반복의 `load()`로 덮어씌워짐
- **판정**: 유효

---

## 수정 검증

- TypeScript 컴파일: ✅ 통과
- 테스트: 46 파일 / 649 테스트 통과 (golden test 17건 기존 실패 — API 키 필요)
- 오탐률: 0% (5/5 유효)
