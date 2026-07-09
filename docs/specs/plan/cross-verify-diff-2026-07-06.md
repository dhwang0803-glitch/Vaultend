# 교차 검증 결과 — 2026-07-06 feature/phase1-quality-prep

## 검증 요약

- 검증 대상: diff — feature/phase1-quality-prep vs development (10파일, +246/-133)
- 검증 방법: CLI 직접 실행 (`codex review --base development`)
- 검증 모델: Codex (gpt-5.4)
- 불일치 항목: 0건
- Codex 단독 지적: 3건 (유효 3건, 오탐 0건)
- 합의 항목: N/A (Claude 자기 평가 미실시)

## Codex 지적 상세

### [P1] Processed 플래그 키 불일치 — CONFIRMED, FIXED

- **파일**: `src/adapters/vault/ObsidianVaultAdapter.ts:177`
- **내용**: `RunInboxProcessUseCase`가 `{ processed: true }`로 frontmatter를 쓰는데, `parseMetadata()`는 `frontmatter['km-processed']`를 읽음. 키 불일치로 Inbox 노트가 무한 재처리됨.
- **대응**: `km-processed` → `processed`로 수정하여 기존 writer와 정합성 확보.

### [P1] Quick Ask 이중 Frontmatter — CONFIRMED, FIXED

- **파일**: `src/application/usecases/QuickAskUseCase.ts:131-142`
- **내용**: `formatAnswer()`가 YAML frontmatter를 생성하는데, `SaveNoteUseCase.createNewNote()`가 `buildFrontmatter()`로 또 다른 frontmatter를 추가. new-note 경로에서 이중 frontmatter, append/daily-note에서는 본문 중간에 YAML 블록 삽입됨.
- **대응**: `formatAnswer()`에서 frontmatter 생성 제거. Q&A markdown body만 반환하도록 수정. quick-ask 전용 metadata(`source`, `question`)는 SaveNoteRequest 확장 시 추가 예정 (Phase 2).

### [P2] Privacy 필터 — tag/frontmatter 규칙 무력화 — CONFIRMED, KNOWN/DEFERRED

- **파일**: `src/application/usecases/QuickAskUseCase.ts:111-112`
- **내용**: `isChunkAllowed()`가 `isNoteAllowedByRules()`에 빈 배열 `[], []`을 전달하여 `folder-exclude`만 동작. `tag-exclude`, `frontmatter-exclude` 규칙이 사실상 무시됨.
- **대응**: Phase 2에서 SearchResult에 메타데이터를 포함시키거나, async vault 조회를 통해 태그/frontmatter 필터링 구현 예정. 현재는 의도적 범위 축소 (동기 처리 제약).

## 수정 반영

- P1 2건: 즉시 수정 후 커밋에 포함
- P2 1건: Phase 2로 연기 (기존 설계 결정과 일치)
- 빌드 확인: `tsc --noEmit` 0 에러, `npm run build` 성공
