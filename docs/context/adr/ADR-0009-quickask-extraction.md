# ADR-0009: Quick Ask 모듈 분리 — obsidian-vault-chat로 이전

- **Status**: Accepted
- **Date**: 2026-07-20
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/architecture, layer/all
- **Supersedes**: ADR-0005

## Context

Vaultend는 "Vault Dependabot" — vault 유지보수 자동화 플러그인으로 포지셔닝하고 있다. Quick Ask(AI 채팅)는 유용하지만 핵심 가치 제안(고아 노트 탐지, 중복 정리, 태그 관리, 구조 리팩터)과 맞지 않는다. 채팅 기능은 별도 플러그인으로 더 적합하다.

Quick Ask는 상당한 코드량(UseCase 539줄, Modal 309줄, CSS 284줄, 테스트 853줄)을 차지하며, 유지보수 비용을 발생시킨다.

## Decision

Quick Ask 관련 코드 전체를 Vaultend에서 제거하고, 독립 Obsidian 플러그인 `obsidian-vault-chat`으로 이전한다.

### 이전 범위

| 카테고리 | 파일 |
|---------|------|
| Domain | QuickAskModels (ChatSession, ChatMessage), SaveTarget, PrivacyRule, NoteChunk, KoreanParticleStripper |
| Application | QuickAskUseCase, SaveNoteUseCase, PromptTemplates (Quick Ask 전용), 8개 Port ABC |
| UI | QuickAskModal, styles.css |
| Tests | QuickAskUseCase.test.ts (853줄), mock-ports, fixtures |
| Docs | ADR-0005 (multiturn chat) |
| i18n | en.ts, ko.ts (Quick Ask 키) |

### Vaultend에서 보존

- `TokenUsage` 인터페이스 → `src/domain/models/TokenUsage.ts`로 분리 (OrganizeModels, AIProviderPort 등이 공유)

### 제거된 Vaultend 기능

- `quick-ask` 커맨드 (Obsidian command palette)
- Quick Ask 설정 UI (save mode dropdown)
- `PluginSettings.quickAskSaveMode` 필드
- `DEFAULT_SAVE_FOLDER = 'QuickAsk'` → `'Vaultend'`로 변경

## Consequences

### Positive
- Vaultend의 코드 복잡도 감소 (-2,425줄)
- "Vault Dependabot" 포지셔닝 명확화
- 두 플러그인이 독립적으로 진화 가능
- Quick Ask 코드와 지식이 보존됨 (삭제가 아닌 이전)

### Negative / Trade-offs
- obsidian-vault-chat은 아직 어댑터 미구현 (src/main.ts 스켈레톤)
- 두 플러그인의 공유 타입(NoteChunk, PrivacyRule 등) 동기화 필요
- Quick Ask를 사용하던 기존 사용자는 별도 플러그인 설치 필요

## Alternatives Considered

- **Quick Ask를 Vaultend에 유지하되 비활성화**: 코드 유지보수 비용이 여전히 발생 — 기각
- **Quick Ask 코드만 삭제 (보존 없이)**: 축적된 지식과 테스트 자산 손실 — 기각

## References

- PR #169: refactor: remove Quick Ask module (extracted to obsidian-vault-chat)
- Repository: github.com/dhwang0803-glitch/obsidian-vault-chat
