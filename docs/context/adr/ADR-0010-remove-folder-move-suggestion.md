# ADR-0010: Organize Note/Folder에서 폴더 이동 제안 제거

- **Status**: Accepted
- **Date**: 2026-07-20
- **Deciders**: @dhwang0803-glitch
- **Tags**: area/organize, layer/application, layer/ui

## Context

Organize Note/Folder 기능은 AI가 노트를 분석하여 태그·링크·폴더 이동을 제안했다. 폴더 이동 제안을 위해 vault의 폴더 프로필(최대 50개 폴더 × 주요 태그), 현재 폴더 위치, inbox 감지 로직이 프롬프트에 포함되었고, 이는 상당한 토큰을 소비했다.

Obsidian 커뮤니티 리서치(Reddit, Discord, 포럼 분석) 결과:
- **대다수 유저가 flat/Zettelkasten 또는 얕은 폴더 + 태그 하이브리드를 사용** — 폴더 이동 제안이 무의미
- PARA/MOC 같은 깊은 폴더 구조는 소수파
- 유저 불만의 핵심은 "폴더 이동이 안 맞다"가 아니라 **"태그/링크 정확도가 낮다"**
- 폴더 프로필 데이터가 프롬프트 토큰의 상당 부분을 차지하여 태그/링크 품질에 투자할 토큰 여유가 부족

## Decision

**Organize Note/Folder에서 폴더 이동 제안 기능을 완전히 제거한다.** 절약된 프롬프트 토큰 예산을 태그 및 링크 제안 정확도 향상에 재투자한다.

- `ClassificationRequest/Response`에서 folder 관련 5개 필드 제거
- `PromptTemplates.classifyAndTag` 시그니처에서 `folderProfiles`, `currentFolder` 제거
- `OrganizeNoteUseCase`, `RunInboxProcessUseCase`에서 folder 빌드/적용 로직 전체 제거
- AI 어댑터 4개에서 folder 파싱 제거
- UI 모달/뷰에서 폴더 드롭다운 및 move 섹션 제거
- i18n 8개 키, CSS 5개 클래스 제거

**Vault Refactor (Pro 기능)의 폴더 관련 코드는 유지한다.** `GenerateRefactorPlanUseCase`, `RefactorPromptTemplates`, `ApplyOrganizeVaultUseCase`, `VaultAccessPort.listFolders()/.moveNote()`는 별도 기능으로 영향 없음.

## Consequences

### Positive
- 프롬프트 토큰 절감 → 태그/링크 제안에 더 많은 컨텍스트 투입 가능
- flat vault 유저에게 불필요한 UI 노이즈 제거
- 코드 복잡도 감소 (21개 파일, -419줄)

### Negative / Trade-offs
- PARA 등 깊은 폴더 구조 유저는 자동 이동 제안을 잃음 (Vault Refactor Pro로 대체 가능)
- 기존 history entries에 `moveTarget` metadata가 남아있는 경우, undo 시 이동된 복사본이 자동 삭제되지 않음 (원본 내용은 정상 복원, 중복만 남음)

### Follow-ups
- 태그 정확도 향상 프롬프트 엔지니어링
- 링크 제안 품질 개선
- property 제안 확장 (향후)

## Alternatives Considered

- **Option A: 폴더 이동을 Pro 전용으로 격상** — 기각: Pro에는 이미 Vault Refactor가 있고, Organize의 단건 이동은 UX가 다름. 유지보수 비용 대비 가치 낮음
- **Option B: 폴더 프로필 수를 줄여 토큰 절감** — 기각: 폴더 10개로 줄여도 정확도가 낮고, 근본적으로 flat vault 유저에게는 무의미한 기능

## References

- PR #192: `feature/remove-folder-suggestion` → `development`
- 커뮤니티 리서치: `docs/specs/plan/market-research-2026-07-17.md`
