# 교차 검증 결과 — 엄격 lint 정리 (chore/strict-lint-cleanup)

- 검증 대상: diff — `eslint.config.mjs`, `src/adapters/history/FileHistoryAdapter.ts`, `src/adapters/ai/__tests__/MaxResponseTokensAIAdapter.test.ts`
- 검증 방법: CLI 직접 실행 (`codex exec -s read-only`, 커스텀 기준: 런타임 동작 변화, 실제 unused 경고 은폐, 테스트 검증력, CLAUDE.md)
- 검증 모델: Codex (codex-cli 0.152.1)
- Codex 종합 판정: PASS (지적 0건)
- 비고: Codex 샌드박스에서 Vitest는 외부 경로 권한 문제로 미실행 → Claude 측 실행 결과 708개 통과

## 배경
Obsidian 리뷰 봇은 업데이트 때도 공식 규칙(`eslint-plugin-obsidianmd` recommended)으로 검사한다. 프로젝트 예외 설정 없이 0.4.1·0.5.1로 검사한 결과 1.0.23은 1.0.22 대비 배포 코드 신규 지적 0건, 테스트 6건(`unbound-method`, 신규 테스트 파일) 신규 + 기존 `Unused eslint-disable directive` 3건.

## 조치와 결과
| 항목 | 조치 | 결과 |
|------|------|------|
| `Unused eslint-disable` 3건 (`FileHistoryAdapter.ts`) | 프로젝트 `no-unused-vars`에 Obsidian 권장과 같은 `ignoreRestSiblings: true` 추가 후 주석 제거 (주석만 지우면 프로젝트 설정에서 경고 3건 발생함을 확인) | 프로젝트 lint 전후 0→0건(가려진 경고 없음), 엄격 검사에서 3건 해소 |
| 테스트 `unbound-method` 6건 | 스파이를 독립 변수로 주입해 메서드 참조 분리 제거 | 엄격 검사(0.4.1·0.5.1) 1.0.22 대비 신규 0건, 테스트 19개 통과 |

## 기타 확인
- CSS: 봇의 과거 지적 2건(`text-decoration` 부분 지원, `:has()`)이 재현되는 기준(데스크톱 Chromium)으로 현재 `styles.css` 0건. 1.0.22 이후 변경 없음.
- `manifest.json`·`package.json`·`LICENSE` (0.5.1): 위반 없음.
- 미해결(별도 결정): `setWarning` deprecated 13건 — `minAppVersion` 1.13 이상 필요(1.0.5에서 1.13 미출시로 롤백, 1.13은 2026-08 일반 공개).
