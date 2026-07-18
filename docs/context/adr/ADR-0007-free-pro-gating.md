# ADR-0007: Free/Pro 기능 게이팅 시스템

- **Status**: Accepted
- **Date**: 2026-07-17
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/monetization, layer/ui, layer/main

## Context

Vaultend를 무료 출시 후 유료 전환하는 수익화 로드맵을 수립했다. 핵심 질문: 어떤 기능을 Pro로 묶을 것인가, 어떻게 게이팅할 것인가.

기존 코드는 모든 기능이 무료로 열려 있었고, 라이선스 개념이 없었다. Clean Architecture를 유지하면서 게이팅을 추가해야 했다.

## Decision

**"발견은 무료, 실행은 Pro"** 원칙을 채택한다.

- 문제를 발견하고 개별 수정하는 것은 Free
- 반복/대량/자동 실행은 Pro

**Pro 기능 2가지**: 폴더 일괄 Organize(`organize-folder`), 자동 Maintenance(`auto-maintenance`, Smart Scheduling 포함). ~~Smart Scheduling~~은 auto-maintenance의 하위 동작으로 통합, ~~중복 태그 일괄 병합~~은 사용자 API를 쓰므로 Free로 전환 (PRD v2, 2026-07-17).

**게이팅은 진입점에서만**: main.ts 커맨드 핸들러와 UI View에서 `LicensePort.canUseFeature()`를 호출한다. UseCase/Domain 레이어는 라이선스를 모른다.

**LicensePort 인터페이스**: `application/ports/LicensePort.ts`에 Port를 정의하고, 초기 구현은 `LocalLicenseAdapter`(로컬 체크섬 검증). 향후 Ed25519 서명 검증 또는 서버 검증 어댑터로 교체 가능.

**일회성 라이선스 키**: `VE-XXXX-XXXX-XXXX-XXXX` 형식. 얼리버드 $29~39, 정가 $49~59.

**기존 사용자 보호**: 첫 업데이트 시 14일 grace period를 `PluginSettings.proGraceDeadline`에 영속화. 갑작스러운 기능 잠금 방지.

## Consequences

### Positive

- Clean Architecture 유지: UseCase/Domain에 수익화 로직 침투 없음
- Port/Adapter 분리로 검증 방식 교체가 어댑터 변경만으로 가능
- UX 훼손 최소화: 시맨틱 검색, Undo, 마스킹, 비용 표시, 단일 노트 작업은 모두 Free
- 기존 사용자에게 14일 유예 → 갑작스러운 전환 반발 방지

### Negative / Trade-offs

- 초기 LocalLicenseAdapter는 체크섬만 사용하므로 키 위조 가능. Phase 3에서 Ed25519로 보강 예정.
- Pro 기능이 4개뿐이라 초기 유료 전환율이 낮을 수 있음. 후보 기능(정리 규칙 프로필, Vault 건강 보고서 등)으로 확장 여지 확보.
- 게이팅 체크가 main.ts와 UI에 분산되어 있어, 새 Pro 기능 추가 시 체크 포인트를 빠뜨리지 않도록 주의 필요.

### Follow-ups

- LocalLicenseAdapter 단위 테스트 추가
- Obsidian 환경 UI QA (라이선스 입력, Pro 뱃지, 토글 비활성화)
- Phase 3: Ed25519 오프라인 라이선스 시스템 구현 (서버 비용 $0 유지)
- Gumroad/Stripe 결제 페이지 연동

## Alternatives Considered

- **서버 기반 라이선스 검증**: 서버 운영 비용 + 복잡도 증가. 초기 단계에서 불필요. Port/Adapter로 나중에 전환 가능하므로 기각.
- **구독 모델**: Obsidian 생태계에서 일회성 구매 선호도가 높음. 서버 기능 없이 구독은 정당화 어려움. 서버 기능 추가 후 재검토.
- **UseCase 레이어에서 게이팅**: Clean Architecture 위반. Domain/UseCase가 수익화 관심사를 알게 됨. 기각.
- **전체 기능 게이팅 (시맨틱 검색 포함)**: UX 훼손이 크고 초기 사용자 확보에 방해. "발견은 무료" 원칙에 위배. 기각.

## References

- PR #128: feat: Free/Pro 게이팅 시스템 구현
- `docs/specs/plan/monetization-strategy-2026-07-12.md`: 수익화 전략 원본
- `docs/specs/plan/cross-verify-diff-2026-07-17-license-gating.md`: Codex 교차검증 결과
