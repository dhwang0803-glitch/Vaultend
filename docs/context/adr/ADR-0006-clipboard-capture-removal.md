# ADR-0006: 클립보드 캡처 기능 제거

- **Status**: Accepted
- **Date**: 2026-07-16
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/scope, layer/application

## Context

Vaultend에 클립보드 내용을 노트로 저장하는 기능(CaptureClipboardUseCase, ClipboardPort, ObsidianClipboardAdapter)이 있었다. 그러나 비정형 문서 파싱(PDF, 이미지 등)에 대한 검토 과정에서 Vaultend의 범위를 재정의하게 되었다:

- Vaultend는 **vault 내부 노트/태그/구조 관리자**이지, 외부 데이터 수집 도구가 아니다
- 클립보드에는 이미지, 리치 텍스트 등 노트로 변환이 어려운 포맷이 들어올 수 있으며, 이를 제대로 처리하려면 별도의 파서 인프라가 필요하다
- 비정형 문서 → Markdown 변환은 별도 플러그인으로 분리하기로 결정 (flowit doc_parser 모듈 참고)

## Decision

클립보드 캡처 기능을 완전히 제거한다:

- `ClipboardPort` (Port ABC), `CaptureClipboardUseCase`, `ObsidianClipboardAdapter` 삭제
- `capture-clipboard` command 등록 해제
- `HistoryAction`에서 `'clipboard-capture'` 타입 제거
- 관련 i18n 문자열, 테스트, E2E 검증 항목 정리

Vaultend의 기능 범위를 vault 내부 관리(노트 정리, 태그 관리, 구조 유지보수, AI 질의)로 한정한다.

## Consequences

### Positive
- 플러그인 범위가 명확해짐 — vault 내부 관리에 집중
- 코드 복잡도 감소 (Port 1개, UseCase 1개, Adapter 1개, 테스트 1개 삭제)
- 향후 비정형 문서 파싱은 별도 플러그인으로 독립 개발 가능

### Negative / Trade-offs
- 클립보드에서 텍스트를 바로 노트로 저장하는 편의 기능 상실
- 기존 사용자가 해당 기능에 의존하고 있었다면 breaking change

### Follow-ups
- 비정형 문서 파싱 플러그인 별도 기획 (flowit doc_parser 참조)

## Alternatives Considered

- **클립보드 기능 유지 + 텍스트만 지원**: 이미지/리치 텍스트 미지원 상태를 명시 — 기각. 반쪽짜리 기능이 혼란을 유발
- **클립보드 + 파서 통합**: vault 관리와 문서 생성이 하나의 플러그인에 공존 — 기각. 범위 비대화, 관심사 분리 위반

## References

- PR #117: 클립보드 제거 + 교차 언어 태그 매칭 수정
- ADR-0003: Inbox 제거 (유사한 범위 축소 결정)
