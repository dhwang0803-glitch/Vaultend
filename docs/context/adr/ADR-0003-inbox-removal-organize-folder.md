# ADR-0003: Inbox 기능 제거 및 Organize Folder 리네이밍

- **Status**: Accepted
- **Date**: 2026-07-16
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/organize, layer/application

## Context

Inbox 자동 감시(파일 생성 이벤트 → 자동 분류)는 Obsidian vault의 사용 패턴과 맞지 않았다. 사용자가 Inbox 폴더에 파일을 넣는 워크플로우보다 **특정 폴더를 지정해 일괄 정리**하는 패턴이 실제 사용에 더 적합했다. 또한 자동 감시는 vault 이벤트 핸들링이 복잡하고, 의도치 않은 파일까지 처리하는 부작용이 있었다.

## Decision

Inbox 자동 감시 기능을 전면 제거하고, 기존 기능을 **Organize Folder**로 리네이밍한다.

- `InboxStatusView` UI 컴포넌트 삭제
- `InboxProgressModal` 삭제
- `RunInboxProcessUseCase` 클래스명을 `OrganizeFolderUseCase`로 변경 (파일명은 유지, re-export)
- 설정 키 마이그레이션: `inboxFolder` → `captureFolder`, `autoApplyInbox` → `autoApplyOrganize`
- `main.ts`에 레거시 설정 마이그레이션 코드 추가

## Consequences

### Positive
- UX 단순화: 사용자가 명시적으로 폴더를 선택해 정리하는 직관적 워크플로우
- vault 이벤트 감시 제거로 퍼포먼스 오버헤드 감소
- 코드 복잡도 감소 (InboxStatusView, InboxProgressModal 제거)

### Negative / Trade-offs
- 파일명 `RunInboxProcessUseCase.ts`가 클래스명 `OrganizeFolderUseCase`와 불일치 (레거시 잔재)
- 일부 CSS 클래스명에 `inbox-` 접두어 잔존 (기능에 영향 없음)

### Follow-ups
- 파일명 리네이밍 (`RunInboxProcessUseCase.ts` → `OrganizeFolderUseCase.ts`) 검토

## Alternatives Considered

- **Inbox 유지 + Organize Folder 병행**: 두 기능의 역할이 겹쳐 혼란 유발 — 기각
- **Inbox를 Organize Folder의 "자동 모드"로 유지**: 자동 감시의 부작용 문제가 해결되지 않음 — 기각

## References

- PR #116: feat: Tag Taxonomy Engine + Maintenance 중복 태그 탐지 (Inbox 제거 포함)
