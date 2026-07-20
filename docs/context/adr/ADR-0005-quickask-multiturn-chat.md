# ADR-0005: Quick Ask 원샷 → 멀티턴 채팅 전환

- **Status**: Superseded by ADR-0008 (Quick Ask 모듈 분리 — obsidian-vault-chat로 이전)
- **Date**: 2026-07-15
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/quick-ask, layer/application, layer/ui

## Context

Quick Ask는 원래 단일 질문-응답(원샷) 모달이었다. 사용자가 후속 질문을 하려면 모달을 다시 열고 컨텍스트를 처음부터 재구성해야 했다. 실제 사용에서는 "이 노트에 대해 더 알려줘", "방금 답변을 요약해줘" 같은 후속 질의가 빈번했다.

## Decision

Quick Ask를 **멀티턴 채팅 인터페이스**로 전환한다.

### 채팅 세션 모델
- `ChatSession`: messages[], referencedNotes, totalTokenUsage, createdAt
- `ChatMessage`: role ('user' | 'assistant'), content, timestamp, tokenUsage?
- 세션은 모달 단위로 생성, 모달 닫기 시 종료

### 컨텍스트 전략 — vault-first, 매 턴 재검색
- 매 턴마다 hybridSearch()를 재실행해 새로운 컨텍스트 반영
- 기존 컨텍스트 청크와 새 검색 결과를 누적 (cap: MAX_CONTEXT_CHUNKS = 20)
- 대화 이력은 슬라이딩 윈도우로 관리 (MAX_MESSAGES = 20)
- `trimMessages()`: 최대 메시지 초과 시 오래된 메시지부터 제거, user-first 순서 유지

### 저장 전략
- 수동 저장: 채팅 중 "저장" 버튼 (모달 하단)
- 자동 저장: 모달 닫기 시 미저장 메시지 ≥ 2이면 자동 저장
- 포맷: `## Turn N` 형식의 Markdown, `#vaultend-qa` 태그
- 토큰/비용 표시: 상태바에 실시간 누적

### Q&A 격리
- Quick Ask 채팅 히스토리는 Maintenance/Organize와 독립적
- `#vaultend-qa` 태그로 저장된 노트는 다른 기능에서 참조하지 않음

## Consequences

### Positive
- 후속 질문이 자연스러워 사용 빈도 향상 기대
- 매 턴 재검색으로 대화가 깊어질수록 더 정확한 vault 컨텍스트 제공
- 자동 저장으로 작업 손실 방지

### Negative / Trade-offs
- 멀티턴 → API 비용 증가 (턴당 검색 + completion)
- 슬라이딩 윈도우로 오래된 컨텍스트 유실 가능
- 모바일에서 채팅 UI 사용성 미검증 (별도 테스트 필요)

### Follow-ups
- 모바일 채팅 UI 사용성 테스트
- 대화 내보내기(export) 기능 검토

## Alternatives Considered

- **원샷 유지 + "관련 질문 추천"**: 자연스러운 후속 대화 불가 — 기각
- **전체 대화 이력 전송 (슬라이딩 윈도우 없이)**: 토큰 폭발 위험 — 기각
- **대화 이력만 사용, 재검색 없이**: 새로운 맥락 반영 불가 — 기각

## References

- PR #114: feat: Quick Ask 원샷 → 멀티턴 채팅 전환
- PR #115: release: v0.5.7 — Quick Ask 멀티턴 채팅
