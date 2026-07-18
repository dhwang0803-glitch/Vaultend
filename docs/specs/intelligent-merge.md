# Intelligent Merge (Phase 3b F3) — 구현 명세

- **작성일**: 2026-07-18
- **상태**: Implemented
- **참조**: `docs/specs/prd-v2-vault-pr.md` F3 (lines 303-369)

> OrganizeVault의 하위 기능으로, 기존 ProposalType 유니온에 `'merge-duplicate-notes'`를 추가하여
> Generate/Apply/Rollback 파이프라인을 재활용한다.

---

## 모듈 역할

RunMaintenanceUseCase가 발견한 `DuplicatePair[]`를 입력받아, AI가 두 노트의 통합본을 생성하고
사용자 승인 시 survivor 노트에 통합본 쓰기 + 백링크 리다이렉트 + donor Archive + 전체 Undo를 수행한다.

---

## 아키텍처 배치

```
기존 OrganizeVault 파이프라인:
  RunMaintenanceUseCase → GenerateOrganizeVaultUseCase → OrganizeVaultView → ApplyOrganizeVaultUseCase
                                                                            → RollbackOrganizeVaultUseCase

Intelligent Merge 확장점:
  ├── Domain: ProposalType union + HistoryAction union + MergeDuplicateNotesDetail
  ├── Generate: generateMergeProposals() + analyzeMergePair()
  ├── Apply: applyMergeDuplicateNotes() (3-step ordered execution)
  ├── Rollback: 변경 없음 (기존 transactionId 기반 역순 undo로 커버)
  ├── OrganizeVaultView: renderMergePreview()
  └── MaintenanceResultView: "AI 병합" 버튼 + Pro 게이트 + main.ts 배선
```

---

## Pro 게이팅

- ProFeatureId: `organize-folder` (기존 공유, 새 ID 불필요)
- OrganizeVaultView: Pro 전용 (기존)
- MaintenanceResultView: "AI 병합" 버튼 클릭 시 `licensePort.canUseFeature('organize-folder')` 체크

---

## Domain Layer 변경

### ProposalType (`OrganizeVaultPlan.ts`)

```ts
type ProposalType = 'reposition' | 'fix-broken-link' | 'merge-duplicate-tags'
                  | 'apply-missing-tags' | 'archive-empty'
                  | 'merge-duplicate-notes';  // 추가
```

### OrganizeVaultProposal — `metadata` 필드

```ts
export interface OrganizeVaultProposal {
  // ... 기존 필드
  readonly metadata?: Record<string, unknown>;
}
```

병합 제안의 metadata에는 `MergeDuplicateNotesDetail` 구조가 저장된다.

### MergeDuplicateNotesDetail

```ts
export interface MergeDuplicateNotesDetail {
  readonly survivorPath: string;
  readonly donorPath: string;
  readonly mergedContent: string;
  readonly mergedTags: ReadonlyArray<string>;
  readonly sourceBlock: string;
  readonly backlinksToRedirect: ReadonlyArray<string>;
}
```

### HistoryAction (`HistoryEntry.ts`)

```ts
type HistoryAction = ... | 'merge-notes';
```

---

## Application Layer 변경

### GenerateOrganizeVaultUseCase

#### `generateMergeProposals(candidates: DuplicatePair[]): Promise<OrganizeVaultProposal[]>`

- pair 단위 순차 처리 (heavy AI 호출, 배치 불가)
- 각 pair에 대해 `analyzeMergePair()` 호출

#### `analyzeMergePair(pair: DuplicatePair): Promise<OrganizeVaultProposal | null>`

1. 양쪽 노트 읽기: `vault.readNote()`
2. 프라이버시 체크: `isNoteAllowedByRules()` — 둘 다 허용 시만 진행
3. 콘텐츠 리댁션: `applyContentRedaction()` 적용
4. 콘텐츠 길이 제한: `MERGE_CONTENT_MAX_LENGTH = 3000`
5. AI 호출: JSON 응답 (`survivorIndex`, `mergedContent`, `mergedTags`, `confidence`, `rationale`)
6. ProposalDiff 5개 구성: merge, content, tags, backlinks, donor
7. metadata에 `MergeDuplicateNotesDetail` 저장
8. 출처 블록: `> [!info] Merged Note\n> Merged from [[donorBasename]] (similarity: N%).`

### ApplyOrganizeVaultUseCase

#### 반환 타입 변경

`applyProposal()`: `Promise<string | null>` → `Promise<string[] | null>`

기존 5개 case는 `wrapSingle()` 헬퍼로 호환 유지.

#### `applyMergeDuplicateNotes(proposal, transactionId): Promise<string[] | null>`

**순서 필수** (backlink redirect → donor archive 순서 위반 시 Obsidian renameFile이 링크를 Archive 경로로 변경):

1. **Survivor 통합본 쓰기**: `writeNote(survivor, mergedContent + sourceBlock)` + `updateFrontmatter(tags)` → HistoryEntry `action:'merge-notes'` with `previousContent`
2. **백링크 리다이렉트**: donor 링크 노트에서 `[[donor]] → [[survivor]]` regex 치환 → 각각 HistoryEntry `action:'modify'` with `previousContent`
3. **Donor Archive**: `moveNote(donor, Archive/donor.md)` → HistoryEntry `action:'archive'` with `metadata.archivedTo`

반환: 전체 entryIds 배열 (rollback용)

### Rollback

변경 없음. `RollbackOrganizeVaultUseCase`가 transactionId로 모든 entry 조회 후 역순 undo:
1. Archive undo → donor 원위치 복원
2. Backlink undo → 원본 콘텐츠 복원
3. Survivor undo → 원본 콘텐츠 복원

---

## UI Layer 변경

### OrganizeVaultView — `renderMergePreview()`

- `<details>` 접이식 토글: 통합본 미리보기 (500자 + `...`)
- Survivor/Donor 파일 링크 (클릭 시 `openFile()`)
- CSS: `vaultend-organize-vault-merge-preview`, `vaultend-organize-vault-merge-content`

### MaintenanceResultView — "AI 병합" 버튼

- `renderDuplicates()`에서 "Open Side by Side" 뒤에 추가
- Pro 게이트: `licensePort.canUseFeature('organize-folder')` 실패 시 Notice
- 콜백: `onMergeRequest(pair: DuplicatePair)` → main.ts에서 수신

### main.ts — `triggerMergeForPair()`

- 최소 MaintenancePlan 생성 (해당 pair만 포함)
- `generateOrganizeVaultUseCase.execute(minPlan)` 호출
- 새 탭에서 OrganizeVaultView 열어 `showPlan()` 전달

---

## i18n 키

| 키 | en | ko |
|----|----|----|
| `organizeVault.type.merge-duplicate-notes` | Merge Notes | 노트 병합 |
| `organizeVault.mergePreview` | Preview Merged Content | 병합 결과 미리보기 |
| `organizeVault.mergeSurvivor` | Survivor | 유지할 노트 |
| `organizeVault.mergeDonor` | Donor (archived) | 보관될 노트 |
| `organizeVault.summaryByType` | ...  \| Merge: {{merge}} | ...  \| 병합: {{merge}} |
| `btn.mergeWithAI` | Merge with AI | AI 병합 |

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/domain/models/OrganizeVaultPlan.ts` | ProposalType union, metadata, MergeDuplicateNotesDetail |
| `src/domain/models/HistoryEntry.ts` | HistoryAction `'merge-notes'` |
| `src/application/usecases/GenerateOrganizeVaultUseCase.ts` | generateMergeProposals(), analyzeMergePair() |
| `src/application/usecases/ApplyOrganizeVaultUseCase.ts` | applyMergeDuplicateNotes(), 반환타입 string[] |
| `src/ui/OrganizeVaultView.ts` | renderMergePreview(), 요약 카운트 |
| `src/ui/MaintenanceResultView.ts` | "AI 병합" 버튼, onMergeRequest 콜백 |
| `src/main.ts` | triggerMergeForPair() 배선 |
| `src/i18n/locales/en.ts` | i18n 키 6개 |
| `src/i18n/locales/ko.ts` | i18n 키 6개 |

---

## 설계 결정 근거

| 결정 | 근거 |
|------|------|
| metadata를 proposal에 inline 저장 | FileOrganizeVaultAdapter.save()가 JSON.stringify로 통째 저장. 별도 저장소 불필요 |
| applyProposal 반환 `string[]` | 병합은 3+ HistoryEntry 생성. 기존 case는 `wrapSingle()`로 호환 |
| 백링크 리다이렉트를 Archive 전에 | Archive 시 Obsidian renameFile이 링크를 Archive 경로로 자동 업데이트 |
| 새 HistoryAction `merge-notes` | 기존 `modify`와 의미 구분 + UI 표시 분리 |
| pair 단위 순차 처리 | 병합은 heavy AI 호출 (전문 전달). 배치 시 토큰 초과 위험 |
| Pro 게이트 `organize-folder` 공유 | 병합은 OrganizeVault 하위 기능. 새 ProFeatureId 불필요 |
