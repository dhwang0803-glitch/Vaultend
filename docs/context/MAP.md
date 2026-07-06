# Project MAP

> 프로젝트 최상위 폴더 **지도**. 파일 인덱스가 아니라 상위 구조 지도다.
> 새 최상위 폴더가 생길 때만 갱신한다. (`docs` 브랜치에서만 편집)

## 최상위 구조

```
obsidian-knowledge-maintenance/
├── src/                    # 플러그인 소스 (Clean Architecture)
│   ├── domain/             #   도메인 레이어 (values, models, errors)
│   ├── application/        #   앱 레이어 (ports, usecases)
│   ├── adapters/           #   어댑터 레이어 (vault, ai, search, history, clipboard, clock)
│   ├── ui/                 #   UI 레이어 (Modal, View, SettingTab)
│   ├── main.ts             #   Composition Root (Plugin 진입점)
│   ├── types.ts            #   플러그인 계층 보조 타입
│   └── constants.ts        #   전역 상수
├── docs/                   # 프로젝트 문서
│   ├── context/            #   공용 지식 베이스 (위키) — docs 브랜치에서만 편집
│   └── specs/              #   모듈별 구현 명세
├── _agent_templates/       # Claude 서브에이전트 템플릿 (TDD 사이클)
├── _claude_templates/      # 브랜치별 CLAUDE.md 템플릿
├── _module_templates/      # 모듈 README 템플릿
├── .claude/                # Claude Code 설정 (commands, settings)
├── .githooks/              # Git 훅 (pre-commit, post-checkout)
├── manifest.json           # Obsidian 플러그인 매니페스트
├── package.json            # Node.js 의존성
├── tsconfig.json           # TypeScript 설정
├── esbuild.config.mjs      # 번들러 설정
└── eslint.config.mjs       # ESLint 9 flat config
```

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 안정 브랜치 (protected) |
| `development` | 통합 브랜치 — feature PR의 base |
| `feature/*` | 기능 단위 개발 |
| `docs` | 문서 전용 (`docs/context/` 편집) |

## 관련 문서

- 아키텍처: [`architecture.md`](./architecture.md)
- 설계 결정: [`decisions.md`](./decisions.md)
