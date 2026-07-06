# Obsidian Knowledge Maintenance Plugin — Claude Code 지침

> 이 파일은 AI_Native_Kit가 생성한 골격입니다. 프로젝트 도메인에 맞게 채우세요.
> TODO 표시는 프로젝트별로 작성이 필요한 부분입니다.

## 프로젝트 개요

TODO: 이 프로젝트가 무엇을 하는지 2~3문장으로 서술하세요.

---

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 안정 브랜치 (protected, 릴리즈 시점에만 merge) |
| `development` | 통합 브랜치 — feature PR의 base |
| `feature/*` | 기능 단위 개발 |
| `hotfix/*` | 안정화/배포 단계 버그 |
| `docs` | 문서 전용 |

| 변경 유형 | 방식 |
|----------|------|
| 기능 구현/변경 | `feature/*` → `development` PR (리뷰 후 merge) |
| 자잘한 수정 (문서/설정/오타) | 현재 브랜치에서 커밋 → PR (리뷰 필수) |
| 릴리즈 | `development` → `main` PR |

---

## 에이전트 템플릿

TDD 사이클 및 코드 리뷰에 사용하는 에이전트 템플릿은 `_agent_templates/`에 위치한다.
새 브랜치 체크아웃 시 `.githooks/post-checkout`이 `{브랜치}/agents/`로 자동 복사한다.

| 에이전트 | 역할 |
|---------|------|
| `ORCHESTRATOR` | TDD 사이클 전체 관리, 에이전트 순서 호출 |
| `TEST_WRITER` | TDD Red — 실패 테스트 작성 |
| `DEVELOPER` | TDD Green — 테스트 통과 최소 구현 |
| `TESTER` | 테스트 실행 및 결과 수집 |
| `REFACTOR` | TDD Refactor — 코드 품질 개선 |
| `REVIEW` | 방어적 코드 리뷰 (8축 점검) |
| `SECURITY_AUDITOR` | 보안 감사 (자격증명/PII 노출 탐지) |
| `IMPACT_ASSESSOR` | PR 전 사후영향 평가 |
| `REPORTER` | 결과 보고서 생성 |

---

## 아키텍처: Clean Architecture (의존성 방향 절대 위반 금지)

```
packages/<shared_schemas>/   ← 최내곽 (Pydantic 등 순수 타입만 의존)
        ↑ import
modules/*/domain/            ← shared_schemas + 자기 도메인만 import
        ↑ import
modules/*/application/        ← domain/* (Port 인터페이스만) + shared_schemas
        ↑ import
modules/*/adapters/           ← domain/ports + 외부 라이브러리
modules/<storage>/            ← 영속화 인프라 — 다른 모듈의 Port ABC 구현
        ↑ import
services/*/                   ← 모든 modules/* 조립 (Composition Root)
```

### 금지 사항

- `domain/` 레이어에서 프레임워크 import 금지 (FastAPI, SQLAlchemy, LangGraph, Celery 등)
- `application/` 레이어에서 구체 Adapter 직접 import 금지 (Port ABC만 참조)
- ORM 모델이 도메인 경계를 넘어가는 것 금지
- `modules/` 간 직접 import 시 상대 모듈의 `domain/ports/`·`domain/entities/`·`domain/value_objects/`만 참조
- `modules/` → `services/` 역방향 의존 금지 (services만 modules 조립)

### Port → Adapter 매핑 (DI 참조표)

> 새 Port를 추가하면 이 표에 행을 추가하세요.

| Port (ABC) 정의 위치 | Adapter 구현 위치 |
|--------------------|----------------|
| TODO `<module>/domain/ports/<Port>` | TODO `<storage>/repositories/` 또는 `<module>/adapters/` |

### 공유 타입은 단일 정의 (SSOT)

- 여러 모듈이 공유하는 엔티티/VO/Enum은 **공유 스키마 패키지**에 단일 정의
- 모듈별 자체 재정의 금지
- Enum은 `str` 상속으로 JSON 직렬화 호환 (`class RiskLevel(str, Enum)`)

---

## 구현 명세 (docs/specs) — 무엇/어떻게의 SSOT

설계 SSOT는 두 겹이다. `docs/context`(위키 = "왜")와 별개:

| 위치 | 역할 | 갱신 규칙 |
|------|------|----------|
| `docs/specs/<module>.md` | 모듈 설계 SSOT (계층별 클래스·시그니처·의존성·환경변수) | **코드 PR과 함께** 갱신 |
| `modules/<module>/README.md` | 모듈 사용 계약(Public API) SSOT | 공개 API 변경 시 |

> use case 시그니처·엔티티 필드·enum이 코드와 spec 사이에서 어긋나면 결함이다.
> 신규 모듈/기능은 `/spec-design`으로 PRD에서 spec + 스캐폴드를 먼저 만든다.

---

## 새 코드 작성 절차

1. **spec·README 읽기**: 작업할 모듈의 `docs/specs/<module>.md`와 `README.md`를 먼저 읽는다
2. **의존성 확인**: 의존성 방향 규칙에 따라 import 가능 여부 확인
3. **레이어 배치**: `domain` / `application` / `adapters` 중 어디인지 판단
4. **공유 타입 사용**: 도메인 엔티티/VO/Enum은 공유 스키마 패키지에서 import
5. **Port 정의/구현 분리**: 인터페이스는 소유 모듈 `domain/ports/`, 구현은 영속화 모듈 또는 자체 `adapters/`
6. **탐색 결과 검증**: sub-agent(Explore 등)가 보고한 클래스명·시그니처는 코드에 사용 전 `Grep`으로 실제 파일에서 반드시 확인
7. **보안 점검**: 하드코딩 금지, `.env` 읽기 금지

---

## 보안 규칙 (필수)

- API 키/비밀번호/토큰 하드코딩 금지 → `os.getenv()` / `process.env` 경유
- `os.getenv("X", "기본값")`의 기본값에 실제 IP·DB명·계정 금지 (표준 포트만 허용)
- `.env`, `*.pem`, `*.key`, `credentials.json`, `.claude/settings.local.json`은 `.gitignore`에 필수
- 자세한 점검 항목은 `_agent_templates/SECURITY_AUDITOR.md` 참조

---

## 자기 편향 방지 규칙 (필수)

LLM은 같은 세션에서 자기 산출물을 평가하면 **자기 편향(self-bias)** 이 발생한다. 이를 구조적으로 방지한다.

### 금지

- **같은 세션에서 자기 코드를 "잘 짰다"고 평가하지 않는다.** "잘 짰습니다", "문제없습니다" 같은 자기 평가는 편향이다.
- **코드 작성 직후 같은 세션에서 최종 품질 평가를 내리지 않는다.** 테스트 통과 여부는 사실이므로 보고하되, 품질 판정은 교차 검증이나 사람에게 맡긴다.
- **하드코딩/회피 패턴**: 테스트 통과만을 위한 하드코딩, `return True`, 빈 `except: pass`, 임시 값 고정 — 이런 패턴이 감지되면 즉시 수정한다. "동작하니까 괜찮다"는 자기 편향의 전형이다.

### 교차 검증 의무 시점

아래 시점에서는 `/cross-verify`로 Codex(외부 모델)의 독립 검증을 권장한다:

| 시점 | 이유 | 자동화 |
|------|------|--------|
| 실행 계획 확정 후 | 계획의 실현 가능성·완전성을 다른 관점에서 검증. dual-write/인프라 정합성 등 아키텍처 문제 사전 발견 | `ExitPlanMode` PostToolUse 훅이 리마인더 자동 출력 |
| 구현 1차 완료 후 | 하드코딩/회피 패턴, 아키텍처 드리프트 탐지 | 수동 |
| PR 생성 전 | 최종 품질 관문 — 작성자(Claude)와 다른 모델(Codex)의 교차 리뷰 | `/pr-report`에서 자동 제안 |

> 교차 검증은 opt-in이다. Codex MCP 설정이 필요하며, 설정 가이드는 `docs/context/cross-verify-guide.md`를 참조한다.
> 계획 확정 시 `ExitPlanMode` 훅이 자동으로 교차검증 리마인더를 출력한다 (`.claude/settings.json`).

---

## 코드 설계 품질 규칙 (필수)

이 프로젝트는 유지보수 가능한 장기 운영 코드를 목표로 한다. "동작하는 코드"가 아니라 "진화할 수 있는 코드"를 짠다.

### 클래스 기반 설계 원칙

- **도메인 엔티티, VO, 서비스, Port, UseCase, Adapter는 반드시 클래스로 구현한다.** 함수 기반 설계는 도메인/유스케이스 수준에서 금지.
- 순수 유틸리티 함수(문자열 변환, 날짜 포맷 등)만 모듈 레벨 함수로 허용.
- "함수 하나로 되는데 클래스가 왜 필요하냐"는 단기적 판단이다. 클래스는 상태 캡슐화, 인터페이스 추상화, 테스트 격리를 보장한다.

### SOLID 원칙 (위반 시 리뷰에서 Major)

| 원칙 | 규칙 | 위반 예시 |
|------|------|----------|
| **S** — 단일 책임 | 클래스/메서드 하나에 하나의 이유로만 변경 | UseCase가 DB 쿼리 + 이메일 발송 + 로깅을 모두 수행 |
| **O** — 개방-폐쇄 | 확장에는 열림, 수정에는 닫힘. if/elif 체인으로 분기하지 않음 | 새 타입 추가마다 기존 함수에 `elif` 추가 |
| **L** — 리스코프 치환 | 하위 클래스는 상위 클래스를 완전히 대체 가능 | 자식 클래스가 부모 메서드를 `raise NotImplementedError`로 막음 |
| **I** — 인터페이스 분리 | 사용하지 않는 메서드에 의존하지 않음 | 10개 메서드 ABC를 구현하는데 3개만 실제 사용 |
| **D** — 의존성 역전 | 상위 모듈이 하위 모듈에 의존하지 않음. 둘 다 추상에 의존 | UseCase가 구체 Repository를 직접 import |

### 디자인 패턴 적용 가이드

무조건 패턴을 쓰는 것이 아니라, **문제 상황에 맞는 패턴을 선택**한다. 적용 시 spec에 근거를 남긴다.

| 상황 | 권장 패턴 | 적용 위치 |
|------|----------|----------|
| 객체 생성 로직이 복잡하거나 조건부 | **Factory** | `domain/services/` 또는 `application/` |
| 여러 서브시스템을 단순화된 인터페이스로 감싸야 할 때 | **Facade** | `application/use_cases/` |
| 동일 인터페이스의 알고리즘을 런타임에 교체 | **Strategy** | `domain/services/` + Port ABC |
| if/elif 체인이 3단계 이상이고 타입별 분기 | **Strategy** 또는 **다형성** | 해당 분기 위치 |
| 이벤트 기반 느슨한 결합 | **Observer / Event** | `domain/events/` |
| 복잡한 객체 조립 | **Builder** | `domain/` 또는 `application/` |
| 여러 Repository를 하나의 트랜잭션으로 | **Unit of Work** | `adapters/` |

### 코드 복잡도 규칙

| 규칙 | 기준 | 조치 |
|------|------|------|
| **시간 복잡도** | O(N^2) 이상 금지 (N이 사용자 데이터/DB 레코드인 경우) | 해시맵/인덱스/배치로 O(N) 이하로 개선 |
| **중첩 루프** | 2단 중첩까지 허용, 3단 이상 금지 | 내부 루프를 별도 메서드로 추출하거나 알고리즘 변경 |
| **조건문 깊이** | if/elif 3단 이상 중첩 금지 | Early return, Guard clause, Strategy 패턴으로 평탄화 |
| **메서드 길이** | 50줄 초과 시 분리 검토 | 단일 책임 원칙에 따라 메서드 분리 |
| **클래스 크기** | 300줄 초과 시 분리 검토 | 책임 분리 후 합성(composition) |
| **매개변수 수** | 5개 초과 시 VO/DTO로 묶기 | 관련 매개변수를 Value Object로 추출 |

### 결합도와 응집도

- **결합도는 낮게**: 모듈 간 의존은 Port(ABC)를 통해서만. 구체 클래스 직접 참조 금지.
- **응집도는 높게**: 한 클래스/모듈 안의 메서드들이 같은 데이터/같은 책임을 다뤄야 한다.
- **Fan-out 경고**: 한 클래스가 5개 이상의 다른 클래스에 의존하면 Facade 또는 책임 분리 검토.
- **God Object 금지**: 모든 것을 아는 클래스/모듈을 만들지 않는다.

---

## 컨벤션

- **Python** ≥ 3.12, lint: `ruff check` (line-length=120), test: `pytest`
- **JS/TS** lint: `npm run lint`, test: `npm run test`
- 타입 힌트/타입 명시 필수
- 파일명 `snake_case` (Python) / 컨벤션 준수 (JS/TS)
- ID 필드는 `UUID` 타입
- Optional은 `T | None`

---

## 프로젝트 위키 (docs/context) — 공용 지식 베이스 SSOT

`docs/context/`는 팀/에이전트가 공유하는 **단일 진실 공급원(SSOT) 지식 베이스**다.
코드만 봐서는 알 수 없는 "왜"와 "전제"를 여기에 남겨 drift를 막는다.

| 파일 | 역할 | 갱신 시점 |
|------|------|----------|
| `docs/context/MAP.md` | 최상위 폴더 지도 | 새 최상위 폴더 생길 때만 |
| `docs/context/architecture.md` | 레이어/데이터 흐름/경계·계약 | 데이터 경로·실행 모드 변경 시 |
| `docs/context/decisions.md` | ADR 인덱스 + 비-ADR 결정 메모 | 결정 추가/반전 시 |
| `docs/context/adr/ADR-NNNN-*.md` | 개별 결정 기록 (1결정 1파일) | 결정마다 (`/adr`로 생성) |

### 운영 규칙 (필수)

1. **위키는 `docs` 브랜치에서만 편집한다.** 코드 브랜치 PR에 `docs/context/`를 절대
   섞지 않는다 (섞였으면 stash/복원 후 중단, `docs` 브랜치로 별도 PR).
2. **ADR 불변성**: 결정을 뒤집어도 원본 ADR을 삭제하지 않는다. 원본에
   `Superseded by ADR-NNNN` 표기 + 새 ADR 추가.
3. **Decision Audit** (PR 직전): "이 변경의 결정을 모르면 다른 작업자가 잘못된 전제로
   일하는가? + 현재 위키만 읽어 파악 가능한가?" → 전자 Yes·후자 No면 위키 갱신 필요.
   `/pr-report`가 이 감사를 수행한다.
4. `.githooks/post-checkout`은 `docs` 브랜치를 작업 폴더 스캐폴딩에서 제외한다.

> `docs` 브랜치가 없으면 `git branch docs`로 먼저 만든다.

---

## 슬래시 커맨드 (스킬)

`.claude/commands/`에 위치. Claude Code가 Skill 도구로 호출한다.

| 커맨드 | 용도 |
|--------|------|
| `/spec-design` | PRD → 아키텍처 설계 → 모듈 분해 → 모듈별 spec + 모노레포 스캐폴딩 |
| `/pr-report` | 커밋 → 보안 점검 → 위키 감사 → PR 생성 자동화 |
| `/pr-3axis-review` | PR 3축 리뷰 (Clean Architecture / SSOT / 크로스 모듈 안전성) |
| `/cross-verify` | 교차 모델 검증 — Claude 산출물을 Codex가 독립 검증 (opt-in, MCP 필요) |
| `/session-retro` | 세션 회고 — 계획 vs 실제 비교, 패턴 분석, 하네스 개선 제안 |
| `/release-sync` | `development` → `release` 충돌 없는 동기화 |
| `/adr` | 새 ADR 생성 + `decisions.md` 인덱스 갱신 (`docs` 브랜치 전용) |

---

## 자동 스킬 호출 규칙 (MANDATORY)

아래 트리거 조건이 충족되면 Claude는 **사용자 확인 없이** 해당 스킬을 Skill 도구로 자동 실행한다. "리마인더만 출력"이 아니라 **실제 스킬을 invoke**하는 것이 핵심이다. 훅은 백업 리마인더일 뿐, 진짜 자동화는 이 규칙이다.

### 트리거 → 스킬 매핑

| 트리거 (사용자 의도) | 자동 실행 스킬 | 체인 |
|---------------------|--------------|------|
| "PR 만들어줘", "PR 생성", "PR 올려줘" 등 PR 생성 요청 | `/pr-report` | → `/session-retro` → `/cross-verify pr` 제안 |
| "리뷰해줘", "PR 리뷰", PR 번호 언급 + 리뷰 | `/pr-3axis-review {PR번호}` | 단독 |
| "설계해줘", PRD 제시 + 구조 설계 | `/spec-design` | 단독 |
| "릴리즈", "release 동기화" | `/release-sync` | 단독 |
| "ADR 작성", 아키텍처 결정 기록 | `/adr {제목}` | 단독 |
| "교차 검증", "cross-verify" | `/cross-verify` | 단독 |
| "회고", "세션 회고", "retro" | `/session-retro` | 단독 |

### 체인 실행 규칙

`/pr-report`는 다음 체인을 포함한다 (pr-report.md Step 3~4에 명시됨):

1. 보안 점검 + 위키 감사 (Step 2~2b)
2. **`/session-retro` 자동 실행** (Step 3) — PR 생성 전에 회고를 먼저 수행
3. **`/cross-verify` 실행 여부를 사용자에게 제안** (Step 4)
   - 코드 파일 변경 포함 → "실행 권장"
   - 문서만 변경 → "건너뛰기 기본"
   - P1/P2 지적 시 즉시 수정 후 커밋에 포함
4. 커밋 → push → **PR 생성** (Step 5~7) — 회고·검증 결과를 PR 본문에 포함

### 매칭 규칙

- 사용자가 한국어/영어 어느 쪽으로 요청하든 의도를 파악하여 매칭한다
- 부분 매칭도 허용: "이거 커밋하고 PR까지" → `/pr-report` 트리거
- 명시적으로 `/커맨드명`을 타이핑하면 해당 스킬을 그대로 실행한다
- **수동 PR 생성 금지**: 사용자가 PR을 요청하면 `gh pr create`를 직접 쓰지 말고 반드시 `/pr-report`를 통해 생성한다

---

## 검증 훅 (Evaluation Loop)

하네스의 검증 루프는 **코드가 아닌 훅으로 강제**한다. 문서에만 규칙을 두면 지켜지지 않는다.

| 훅 | 트리거 | 동작 |
|----|--------|------|
| `.githooks/pre-commit` | `git commit` | 보안 점검 + 린트 자동 실행. 실패 시 커밋 차단 |
| `.githooks/post-checkout` | 새 브랜치 생성 | 에이전트 템플릿 + 폴더 스캐폴딩 자동 생성 |

### 세션 훅 (`.claude/settings.json`)

| 이벤트 | 동작 |
|--------|------|
| `UserPromptSubmit` | 세션 컨텍스트 로드 (아키텍처·보안 규칙 + 교차 검증 리마인더) |
| `PostToolUse` (Bash\|PowerShell, `git commit` 포함) | 세션 회고 리마인더 출력 |
| `PostToolUse` (ExitPlanMode) | 계획 교차검증 리마인더 출력 |

> 훅은 백업 리마인더다. 실제 자동화는 위의 "자동 스킬 호출 규칙"이 담당한다.

---

## 설치 점검

Claude Code 버전 업데이트 후 하니스가 멀쩡한지 `ai-native-kit doctor`로 점검한다
(에셋·git 훅·.gitignore·CC 버전·알려진 quirk).
