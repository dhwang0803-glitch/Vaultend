# 교차 검증 보고서: maintenance-competitive-parity

- **날짜**: 2026-07-11
- **검증 대상**: diff — feature/maintenance-competitive-parity vs development
- **검증 방법**: CLI 직접 실행 (codex review --base development)
- **검증 모델**: Codex (gpt-5.6-sol)
- **Codex CLI 버전**: 0.144.1

## 지적 사항 (4건 — 전수 유효)

| # | 심각도 | 파일 | 지적 내용 | 대응 |
|---|--------|------|----------|------|
| 1 | P1 | RunMaintenanceUseCase.ts:352 | `decodeURIComponent` URIError 미처리 — `100%.md` 같은 링크가 전체 스캔 중단 | ✅ try/catch 추가, 실패 시 broken link로 보고 |
| 2 | P2 | RunMaintenanceUseCase.ts:361-363 | 경로 포함 마크다운 링크(`missing/foo.md`)에서 basename만 체크하여 다른 폴더의 동명 파일이 있으면 오탐 | ✅ fullPathSet 먼저 체크, 명시적 경로는 basename shortcut 미적용 |
| 3 | P2 | RunMaintenanceUseCase.ts:296-302 | 중첩 폴더 노트 fragment 검증 시 `readNote('nested-note.md')` → null, 깨진 헤딩 미보고 | ✅ basenameToPath 맵으로 실제 경로 해석 후 readNote |
| 4 | P2 | ObsidianVaultAdapter.ts:75 | `startsWith(folder)` → `'Foo'`가 `'Foobar/'`에 매치 | ✅ `startsWith(folder + '/')` 경계 추가 |

## 사실 확인

- P1: `decodeURIComponent('100%.md')` → 실제로 URIError throw 확인 → **유효**
- P2 basename: `[x](missing/foo.md)` → basename 'foo' 매치로 다른 폴더 foo.md 통과 → **유효**
- P2 fragment: `readNote` with non-existent flat path → null → fragment skip → **유효**
- P2 folder: `'Foo'.startsWith('Foo')` = true → `Foobar/` 포함 → **유효**

## 오탐: 0건

## 종합

- 불일치 항목: 0건 (Codex 4건 모두 Claude가 동의, 즉시 수정)
- Codex 단독 지적: 4건 (전수 유효)
- 합의 항목: 보안 이슈 없음, 아키텍처 위반 없음, 테스트 통과
- 오탐률: 0%
