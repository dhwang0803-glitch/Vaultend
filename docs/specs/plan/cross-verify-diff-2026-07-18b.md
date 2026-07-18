# 교차 검증 보고서 — 2026-07-18b

- **검증 대상**: diff — Phase 3b Intelligent Merge + Pro gating 재설계
- **검증 방법**: CLI 직접 실행 (`codex exec`)
- **검증 모델**: Codex (o4-mini)

## 종합 판정

Codex: **FAIL** → P2 수정 2건 후 **PASS**

| # | Codex 심각도 | 분류 | 지적 내용 | 사실 확인 | 대응 |
|---|------------|------|----------|----------|------|
| 1 | CRITICAL | P3 (기존 패턴) | 병합 도중 실패 시 rollback 누락 | 유효하나 기존 5개 ProposalType 모두 동일 패턴 — 신규 아님 | 전체 ApplyUseCase 후속 개선으로 추적 |
| 2 | HIGH | **P2 → 수정 완료** | 겹치는 pair(A-B, A-C)가 stale overwrite 유발 | **확인됨** — dedup 없음 | `generateMergeProposals()`에 `usedNotes` Set 추가 |
| 3 | HIGH | P3 (MVP 한계) | 백링크 리다이렉트가 `[[name]]`/`[[name\|alias]]`만 처리 | 확인됨 — `[[folder/name]]`, `#heading`, `^block` 미지원 | 후속 개선 (Obsidian metadataCache 활용) |
| 4 | HIGH | P3 (의도적) | 3,000자 절단으로 "모든 정보 보존" 불가 | 확인됨 — 의도적 토큰 제한 | 문서화, 후속 청크 병합 방식 검토 |
| 5 | HIGH | **P2 → 수정 완료** | survivor 기존 frontmatter(aliases, category 등) 소실 | **확인됨** — writeNote가 전체 교체 | 기존 frontmatter 블록 보존 후 tags만 갱신 |
| 6 | MEDIUM | P3 | AI 응답 metadata 캐스팅만, 검증 없음 | 부분 유효 — line 314에 기본 guard 있으나 불완전 | 후속 type guard 강화 |
| 7 | MEDIUM | P3 | rollback 역순이 timestamp 충돌 시 미보장 | 유효하나 프로덕션 위험 낮음 (ms 단위 차이) | 후속 sequence 필드 추가 |
| 8 | MEDIUM | P3 | AI 실패가 "제안 없음"으로 위장 | 확인됨 — `catch { return null }` | 후속 로깅/에러 상태 전달 |

## P2 수정 상세

### Finding 2: 겹치는 pair dedup

`generateMergeProposals()`에 `usedNotes: Set<string>` 추가. 각 pair 처리 전 양쪽 note가 이미 사용되었는지 확인하고, 사용된 경우 skip. 성공한 proposal의 양쪽 note를 Set에 추가.

### Finding 5: frontmatter 보존

`applyMergeDuplicateNotes()`에서 `writeNote()` 전 survivor의 기존 frontmatter 블록(`---\n...\n---\n`)을 regex로 추출하여 merged content 앞에 prepend. 이후 `updateFrontmatter({ tags })` 호출이 기존 속성을 보존하면서 tags만 갱신.

## 불일치 항목 (Claude vs Codex)

| # | Codex 판정 | Claude 판정 | 이유 |
|---|-----------|-----------|------|
| 1 | CRITICAL | P3 | 기존 5개 proposal type 모두 동일 패턴. merge만 수정하면 불일치 발생. 전체 리팩토링 필요 |
| 3 | HIGH | P3 | MVP 단계 명시적 한계. `[[name]]` 형식이 Obsidian wiki link의 90%+ |
| 4 | HIGH | P3 | 의도적 설계 — 토큰 비용 vs 완전성 트레이드오프 |

## 오탐: 0건

CLI 실행으로 Codex가 파일 시스템에 직접 접근하여 모든 지적이 사실에 기반.
