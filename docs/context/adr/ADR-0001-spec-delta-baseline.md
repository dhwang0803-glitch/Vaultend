# ADR-0001: Codex 초기기획 분기 기준선 — 현재 코드 우선 원칙

- **Status**: Accepted
- **Date**: 2026-07-06
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/architecture, layer/all

## Context

2026-07-06 Codex가 생성한 초기 아키텍처 명세(`obsidian-knowledge-maintenance-architecture-spec.md`, 4048줄)를 기반으로 프로젝트 골격이 만들어졌다. 이후 실제 Obsidian 플러그인 환경에 맞추어 코드가 수정되었으나, 어떤 변경이 의도적이고 어떤 것이 단순 누락인지 기록되지 않았다.

명세를 그대로 따르면 현재 코드 구조와 충돌하거나, ESLint 9 / esbuild 호환 문제를 일으키거나, Clean Architecture 경계를 오히려 위반하는 경우가 확인되었다.

## Decision

**현재 코드가 초기 명세보다 우선한다.** 스텁 구현 시 명세를 참고하되, 아래 분기 항목에서는 반드시 현재 코드의 방식을 따른다.

### 의도적 분기 9건

| ID | 항목 | 현재 코드 | 명세 | 분기 이유 |
|----|------|----------|------|----------|
| D1 | settings 필드 선언 | `declare settings: PluginSettings` | `private settings!: PluginSettings` | Obsidian Plugin 베이스 클래스의 런타임 초기화와 TypeScript strict 모드 동시 충족 |
| D2 | GetHistoryUseCase | 존재 (8번째 UseCase) | 없음 (7개만) | MaintenanceLogView가 HistoryPort를 직접 참조하지 않도록 분리. Clean Architecture에 더 부합 |
| D3 | AI HTTP 로직 | 각 어댑터 자체 `makeRequest()` | `HttpClient` 래퍼 클래스 분리 | 두 AI API의 URL 구조·인증·에러 매핑이 충분히 다름. 공유 래퍼는 과도한 추상화 |
| D4 | ESLint 설정 | ESLint 9 flat config | `eslint-plugin-import` + `.eslintrc.js` | ESLint 9와 eslint-plugin-import 호환 이슈. 의존성 방향 검증은 CI 커스텀 스크립트로 대체 |
| D5 | import 경로 | 상대 경로 (`../../domain/values/`) | tsconfig paths (`@domain/*`) | esbuild가 tsconfig paths를 기본 해석 못함. 추가 플러그인 없이 상대 경로가 더 단순 |
| D6 | 프롬프트 관리 | PromptTemplates.ts 존재 + AI 어댑터에 인라인 프롬프트 병존 | PromptTemplates만 사용 | **현재는 과도기 상태.** 스텁 구현 시 PromptTemplates로 통합하고 어댑터 인라인 프롬프트 제거 예정 |
| D7 | runCatchUp 로직 | 에러 핸들링만 | processedCount 로깅 포함 | 단순화. 로깅은 기능 완성 후 추가 |
| D8 | Notice import | 콜백 내 동적 import / require | 파일 상단 static import | 번들러가 obsidian을 external 처리하므로 기능상 동일. 향후 통일 예정 |
| D9 | 제품명 | **Noluma** | KM Plugin / Vaulta | 최종 확정. 명세의 옛 이름 사용 금지 |

### 회귀 위험 6건 — 명세 따르면 안 되는 것

| ID | 항목 | 명세의 문제 | 올바른 방향 |
|----|------|-----------|-----------|
| R1 | AI 어댑터에 프롬프트 구성 | `buildClassificationPrompt()`가 어댑터 내부에 인라인 | 프롬프트 구성은 UseCase/PromptTemplates 책임. 어댑터는 API 호출만 |
| R2 | 도메인 에러 미사용 | UseCase가 `new Error()`만 사용 | `NoteNotFoundError`, `PrivacyViolationError` 등 도메인 에러 클래스 활용 |
| R3 | ConfigPort 중복 생성 | `main.ts`에 3개의 인라인 ConfigPort 객체 | 한 번만 생성하여 공유. registerViews의 no-op 구현 제거 |
| R4 | SearchNotesUseCase 미연결 | import만 존재, wireUseCases()에서 미인스턴스화 | 독립 검색 명령 필요 시 연결. 불필요하면 import 제거 |
| R5 | SaveTarget as any 캐스팅 | Quick Ask 명령에서 discriminated union 무시 | SaveTarget 팩토리 함수 또는 올바른 타입 리터럴로 생성 |
| R6 | 상수 인라인 중복 | constants.ts와 뷰/어댑터에 동일 상수 중복 정의 | constants.ts를 SSOT로, 개별 파일은 import |

## Consequences

### Positive
- 스텁 구현 시 명세와 현재 코드 간 혼란 방지
- 코드 품질 이슈 6건을 사전에 식별하여 구현 전 정리 가능
- 향후 기여자가 "명세에는 이렇게 되어 있는데" 하고 회귀하는 것을 방지

### Negative / Trade-offs
- 명세의 일부 좋은 설계(HttpClient 래퍼, RateLimiter)를 당장 구현하지 않음
- 명세와 코드 사이의 불일치가 명시적으로 관리되어야 함

### Follow-ups
- [ ] R1~R6 코드 품질 이슈 해결 (Phase 1 구현 전 선행)
- [ ] `docs/specs/spec-delta-register.md` — 전체 스텁 17건의 구현 가이드
- [ ] PromptTemplates 통합 리팩토링 (D6 해결)

## Alternatives Considered

- **Option A: 명세를 정본으로 삼고 코드를 명세에 맞춤** — 기각. ESLint 9, esbuild, Obsidian Plugin API 호환 문제를 다시 일으킴.
- **Option B: 명세를 완전히 폐기** — 기각. 명세의 대부분(22개 일치 항목)은 여전히 유효한 구현 가이드.

## References

- 초기 명세: `obsidian-knowledge-maintenance-architecture-spec.md` (Codex 생성, 2026-07-06)
- 초기 PRD: `obsidian-knowledge-maintenance-prd.md` (Codex 생성, 2026-07-06)
- 구현 참조: `docs/specs/spec-delta-register.md`
