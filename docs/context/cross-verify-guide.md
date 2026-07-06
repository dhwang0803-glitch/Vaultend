# 교차 모델 검증 가이드

> 이 문서는 Codex MCP를 활용한 교차 모델 검증 파이프라인의 설정 및 운영 가이드다.
> 검증 실행: `/cross-verify` | 세션 회고: `/session-retro`

---

## 왜 교차 검증이 필요한가

LLM은 자기 자신이 낸 결과물을 평가할 때 **자기 편향(self-bias)** 이 발생한다. 같은 세션에서 "네 코드를 평가해봐"라고 하면 높은 확률로 "잘했습니다"를 반환한다. 이는 모델이 잘못된 것이 아니라, 같은 컨텍스트 안에서 자기 산출물을 부정하기 어려운 구조적 한계다.

### 교차 검증의 이점

| 패턴 | 문제 | 해결 |
|------|------|------|
| 자기 평가 | "잘 짰습니다" 편향 | 다른 모델이 독립적으로 평가 |
| 단일 관점 | 한 모델의 학습 편향 | 다른 학습 데이터 기반 관점 |
| 하드코딩/회피 | 테스트 통과만을 위한 꼼수 | 외부 모델이 패턴 탐지 |
| 아키텍처 드리프트 | 작업 누적 시 방향 이탈 | 원칙 기준 독립 검증 |

---

## Codex MCP 설정

### 사전 요구사항

- Node.js 18.18 이상
- OpenAI API 키 ([platform.openai.com/api-keys](https://platform.openai.com/api-keys))
- OpenAI Codex CLI (`npm install -g @openai/codex`)

### 1단계: Codex CLI 설치 및 로그인

```bash
# OpenAI Codex CLI 설치
npm install -g @openai/codex

# 로그인 (브라우저 인증 또는 API 키 등록 — auth.json에 저장됨)
codex login
```

> ⚠️ `codex login`은 API 키를 `~/.codex/auth.json`에 저장한다. 이후 키를 변경할 때도 이 파일을 갱신해야 한다 (아래 트러블슈팅 참조).

### 2단계: 프로젝트 .env에 API 키 설정

프로젝트 루트의 `.env` 파일에 추가:

```bash
# 변수명이 정확히 OPENAI_API_KEY 여야 한다 (OPEN_API_KEY 등 오타 주의)
OPENAI_API_KEY=sk-proj-...
```

### 3단계: Claude Code에 MCP 서버 등록

`.claude/settings.json` (프로젝트 레벨)에 추가:

```jsonc
{
  "mcpServers": {
    "codex": {
      "type": "stdio",
      "command": "bash",
      "args": ["-c", "set -a && source .env && set +a && npx -y codex-mcp-server"]
    }
  }
}
```

> ⚠️ `OPENAI_API_KEY`를 settings.json에 직접 하드코딩하지 않는다.
> `.env`는 반드시 `.gitignore`에 포함되어야 한다.

### 4단계: 연결 확인

Claude Code 세션에서:
```
Codex MCP 연결 상태를 확인해줘
```

MCP 도구 목록에 `mcp__codex-cli__codex`, `mcp__codex-cli__review` 등이 보이면 설정 완료.

### API 키 우선순위

Codex CLI는 API 키를 아래 순서로 탐색한다. 상위가 우선:

| 우선순위 | 소스 | 경로 |
|---------|------|------|
| 1 | `~/.codex/auth.json` | `codex login` 시 저장 |
| 2 | 환경변수 `OPENAI_API_KEY` | `.env` 또는 시스템 환경변수 |

**키를 변경했는데 반영이 안 되면 `auth.json`이 옛날 키를 물고 있을 가능성이 높다.** 아래 트러블슈팅 참조.

---

## 트러블슈팅

### 401 Unauthorized — API 키가 맞는데 인증 실패

**증상**: `.env`와 시스템 환경변수를 모두 갱신했는데도 `401 Unauthorized` 에러가 반복된다. 에러 메시지의 키 끝 4자리가 내가 설정한 키와 다르다.

**원인**: `~/.codex/auth.json`에 옛날 키가 저장되어 있다. Codex CLI는 이 파일의 키를 환경변수보다 우선 사용하므로, `.env`를 아무리 바꿔도 효과가 없다.

**해결**:
```bash
# 1. 현재 auth.json의 키 확인 (끝 4자리만)
python3 -c "
import json
with open('$HOME/.codex/auth.json') as f:
    data = json.load(f)
key = data.get('OPENAI_API_KEY', '')
print(f'auth.json 키: ...{key[-4:]} (길이: {len(key)})')
"

# 2. 방법 A: codex login 재실행 (권장)
codex login

# 2. 방법 B: auth.json 직접 교체 (BOM 없는 UTF-8로 작성해야 함)
# 아래 명령어에서 sk-proj-... 부분을 새 키로 교체
printf '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-proj-...새키..."}' > ~/.codex/auth.json
```

> ⚠️ Windows PowerShell의 `Out-File -Encoding utf8`은 BOM(`ef bb bf`)을 붙인다. BOM이 있으면 Codex CLI가 JSON 파싱에 실패하므로, 반드시 `bash`의 `printf` 또는 BOM 없는 UTF-8로 작성해야 한다.

### JSON 파싱 에러 — "expected value at line 1 column 1"

**증상**: API 호출 시 `expected value at line 1 column 1` 에러가 발생한다. 401 에러는 아니다.

**원인**: `~/.codex/auth.json` 파일에 BOM(Byte Order Mark) 또는 CRLF 줄바꿈이 포함되어 있다. Windows에서 PowerShell이나 메모장으로 파일을 편집하면 자동으로 붙는다.

**확인**:
```bash
# 첫 3바이트가 ef bb bf 이면 BOM이 있는 것
xxd ~/.codex/auth.json | head -1
```

**해결**:
```bash
# BOM 없이 재작성 (bash에서 실행)
printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}' "$OPENAI_API_KEY" > ~/.codex/auth.json
```

### .env 변수명 오타

**증상**: `.env`에 키를 설정했는데 Codex가 인식하지 못한다.

**원인**: 변수명이 `OPENAI_API_KEY`가 아닌 다른 이름(예: `OPEN_API_KEY`, `OPENAI_KEY` 등)으로 되어 있다.

**확인**:
```bash
# .env의 변수명만 출력 (값은 노출하지 않음)
grep -oE '^[A-Z_][A-Z0-9_]*' .env
```

**해결**: 변수명을 정확히 `OPENAI_API_KEY`로 수정한다.

### 세션 재시작해도 키가 안 바뀜

**증상**: Claude Code 세션을 여러 번 재시작해도 계속 옛날 키를 사용한다.

**원인**: MCP 서버는 세션 시작 시 spawn되지만, Codex CLI가 `~/.codex/auth.json`에서 키를 읽으므로 환경변수만 바꿔서는 소용없다.

**해결**: 위 "401 Unauthorized" 해결 방법대로 `auth.json`을 갱신한 뒤 세션을 재시작한다.

### 설정 검증 체크리스트

새로 설정하거나 문제가 생겼을 때 아래를 순서대로 확인한다:

```bash
# 1. .env 변수명 확인 (OPENAI_API_KEY 여야 함)
grep -oE '^[A-Z_][A-Z0-9_]*' .env

# 2. auth.json 키 끝 4자리 확인
python3 -c "import json; d=json.load(open('$HOME/.codex/auth.json')); print(d.get('OPENAI_API_KEY','')[-4:])"

# 3. .env 키 끝 4자리 확인 (두 값이 일치해야 함)
bash -c 'set -a && source .env && set +a && echo ${OPENAI_API_KEY: -4}'

# 4. auth.json에 BOM이 없는지 확인 (첫 바이트가 7b '{' 여야 정상)
xxd ~/.codex/auth.json | head -1

# 5. MCP 연결 테스트 (Claude Code 세션 내에서)
# → "Codex MCP ping 테스트해줘"
```

---

## 교차 검증 파이프라인 아키텍처

### 실행 방법별 비교

| | CLI 직접 실행 (권장) | MCP 도구 호출 (폴백) |
|---|---|---|
| **실행 방법** | `codex review --base main` | `mcp__codex-cli__codex` |
| **파일 접근** | 전체 파일 시스템 | 프롬프트에 포함된 내용만 |
| **컨텍스트 손실** | 없음 | diff 요약/분할 시 발생 |
| **오탐 확률** | 낮음 | 높음 (파일 존재 추측 등) |
| **커스텀 기준** | `codex exec "프롬프트"` 사용 | 프롬프트에 직접 명시 |
| **사실 확인 부담** | 경량 (의심 항목만) | 전수 검증 필요 |

### 파이프라인 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: 생성 (Claude Code)                                │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐     │
│  │  Plan   │→│  Spec   │→│  Code    │→│  Test    │     │
│  └─────────┘  └─────────┘  └──────────┘  └──────────┘     │
└──────────────────────┬──────────────────────────────────────┘
                       │ /cross-verify
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: 검증 (우선순위 순서로 시도)                         │
│                                                             │
│  ┌─ 2-a. CLI 직접 실행 (권장) ──────────────────────────┐   │
│  │  Claude가 Bash로 codex review --base main 실행       │   │
│  │  Codex가 직접 파일 시스템 접근 → 컨텍스트 손실 없음   │   │
│  └──────────────────────────────────────────────────────┘   │
│           │ CLI 미설치 시                                    │
│           ▼                                                 │
│  ┌─ 2-b. MCP 도구 호출 (폴백) ─────────────────────────┐   │
│  │  Claude가 diff 수집 → 프롬프트에 포함하여 MCP 호출   │   │
│  │  ※ 컨텍스트 손실 있음, 오탐 주의                     │   │
│  └──────────────────────────────────────────────────────┘   │
│           │ MCP도 불가 시                                    │
│           ▼                                                 │
│  ┌─ 2-c. 수동 모드 ────────────────────────────────────┐   │
│  │  프롬프트 파일 저장 → 사용자가 외부에서 실행          │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: 사실 확인 + 비교 (Claude Code)                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ 사실확인 │  │ 불일치       │  │ 합의 (고신뢰)      │    │
│  │ CLI→경량 │  │ 추출         │  │ 요약               │    │
│  │ MCP→전수 │  │              │  │                    │    │
│  └──────────┘  └──────────────┘  └────────────────────┘    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
                 🧑 사람 판단
                 (불일치 항목 최종 결정)
                       │
                       ▼
                 /session-retro
                 (패턴 학습 → 하네스 개선)
```

---

## Codex 검증 실행 방법

### 1순위: CLI 직접 실행 (권장)

Claude가 Bash 도구로 Codex CLI를 직접 실행한다. Codex가 로컬 파일 시스템에 접근하므로 **컨텍스트 손실이 없다.**

```bash
# PR diff 검증 (기본 리뷰 기준)
codex review --base main

# plan/spec 검증 (커스텀 기준)
codex exec "검증 프롬프트..."
```

#### CLI 실행 시 주의사항

| 항목 | 설명 |
|------|------|
| 타임아웃 | Codex 리뷰는 2~5분 소요. Bash 호출 시 `timeout: 600000` 설정 |
| 출력 크기 | 리뷰 결과가 30KB 넘으면 잘릴 수 있음. 잘린 경우 저장된 파일에서 읽기 |
| `--base`와 `[PROMPT]` | `codex review`에서 동시 사용 불가. 커스텀 기준이 필요하면 `codex exec` 사용 |
| 인증 | `~/.codex/auth.json`에 유효한 API 키 필요. 실패 시 위 트러블슈팅 참조 |

#### CLI vs MCP: 왜 CLI가 더 나은가

MCP를 통해 Codex를 호출하면 Codex 에이전트가 프롬프트에 포함된 내용만 볼 수 있다. 반면 CLI로 직접 실행하면 Codex가 스스로 `git diff`를 실행하고 파일을 읽는다:

```
MCP 모드:  Claude diff 수집 → 요약/분할 → 프롬프트에 포함 → Codex 검토
              ↑ 정보 손실                    ↑ 파일 접근 불가 → 오탐

CLI 모드:  Claude가 codex review 실행 → Codex가 직접 diff + 파일 읽기 → 검토
                                          ↑ 전체 컨텍스트 보유 → 정확
```

### 2순위: MCP 도구 호출 (CLI 미설치 시 폴백)

Codex CLI가 설치되어 있지 않은 환경에서만 사용한다.

> **핵심 제약**: Codex MCP 에이전트는 셸 명령을 실행하지 않고 파일에 접근하지 않는다. Claude가 모든 컨텍스트를 수집하여 프롬프트에 포함시켜야 한다.

| 도구 | 제한 | 교차 검증 적합성 |
|------|------|-----------------|
| `mcp__codex-cli__review` | `--base`와 커스텀 프롬프트 동시 사용 불가 | 검증 기준 지정 불가 |
| `mcp__codex-cli__codex` | 프롬프트에 내용을 직접 포함해야 함 | **MCP 모드에서 사용** |

#### MCP 모드에서의 사실 확인

MCP 모드에서는 Codex가 파일을 못 보므로 오탐 확률이 높다. Claude는 결과를 받은 후 **모든 지적을 검증**해야 한다:
- 파일 존재 여부 주장 → `Glob`/`Grep`으로 확인
- 패키지명/버전 주장 → `npm view`/`pip show`로 확인
- 설정값 주장 → 해당 파일을 `Read`로 확인

CLI 직접 실행 시에는 Codex가 파일에 접근하므로 의심스러운 항목만 선별 확인하면 된다.

---

## 언제 교차 검증을 사용하는가

| 시점 | 검증 대상 | 명령 |
|------|----------|------|
| 실행 계획 확정 전 | plan | `/cross-verify plan` |
| spec 작성 완료 후 | spec | `/cross-verify spec` |
| 구현 1차 완료 후 | code | `/cross-verify code` |
| PR 생성 전 | diff 전체 | `/cross-verify pr` |

### 권장 체크포인트

```
/spec-design  →  /cross-verify plan  →  구현  →  /cross-verify code  →  /pr-report  →  /cross-verify pr
```

모든 단계에서 교차 검증을 할 필요는 없다. **위험도가 높은 시점**에 집중한다:
- 새 모듈/서비스 설계 시 → plan/spec 검증
- 복잡한 비즈니스 로직 구현 시 → code 검증
- 크로스 모듈 변경이 있는 PR → pr 검증

---

## 세션 훅: 강제 컨텍스트 주입

문서에 규칙을 써 놓기만 하면 모델이 읽지 않을 수 있다. **세션 시작 시 강제로 주입**해야 한다.

### Claude Code 훅 설정

`.claude/settings.json`에 훅을 추가한다:

```jsonc
{
  "hooks": {
    // 세션 시작 시 핵심 규칙 강제 주입
    "user_prompt_submit": [
      {
        "matcher": "",
        "command": "echo '--- [SESSION CONTEXT] ---' && head -100 CLAUDE.md 2>/dev/null && echo '--- [SECURITY RULES] ---' && grep -A 5 '보안 규칙' CLAUDE.md 2>/dev/null && echo '--- [CROSS-VERIFY REMINDER] ---' && echo '교차 검증 활성화됨. 주요 산출물 완성 후 /cross-verify를 실행하세요.'"
      }
    ],
    // 커밋 후 세션 회고 알림
    "PostToolUse": [
      {
        "matcher": "Bash",
        "command": "bash -c 'if echo \"$TOOL_INPUT\" | grep -q \"git commit\"; then echo \"[REMINDER] 세션 종료 전 /session-retro로 회고를 기록하세요.\"; fi'"
      }
    ]
  }
}
```

### 훅이 하는 일

| 훅 | 트리거 | 동작 |
|----|--------|------|
| `user_prompt_submit` | 사용자 입력 시 | CLAUDE.md 핵심 규칙 + 보안 규칙 + 교차 검증 리마인더 주입 |
| `PostToolUse` (Bash) | git commit 실행 후 | 세션 회고 리마인더 출력 |

> ⚠️ 훅은 세션 시작 시 자동 실행되므로 규칙 누락을 구조적으로 방지한다. "문서를 안 읽었다"는 변명이 불가능해진다.

---

## 비용과 트레이드오프

| 항목 | 비용 | 가치 |
|------|------|------|
| Codex API 비용 | 검증 1회당 ~$0.5-2 | 하드코딩/회피 패턴 사전 차단 |
| 검증 대기 시간 | 1-3분 | 배포 후 롤백보다 저렴 |
| 컨텍스트 오버헤드 | 검증 결과가 세션에 추가됨 | 불일치 해소로 품질 향상 |

### 비용 절감 팁

- 모든 변경에 교차 검증을 걸지 않는다. 위험도 기반으로 선별.
- plan/spec 검증은 코드 검증보다 저렴하다 (토큰이 적음).
- `/session-retro`로 불필요한 검증을 식별하고 빈도를 조정한다.

---

## 팀 운영 패턴

### 스킬 공유

효과적인 교차 검증 프롬프트를 발견하면 팀과 공유한다:

1. `/cross-verify` 결과에서 효과적이었던 검증 기준을 추출
2. `_agent_templates/` 또는 `.claude/commands/`에 반영
3. 팀 레포에 push → 동료 에이전트가 리뷰

### 하네스 진화 사이클

```
세션 작업 → /session-retro (회고)
    → 하네스 개선 제안 도출
    → CLAUDE.md / 에이전트 / 커맨드 수정
    → 다음 세션에서 개선 확인
    → /session-retro (반복)
```

> 하네스는 한 번 만들고 끝나는 것이 아니다. 모델이 업데이트되면 기존 하네스의 상당 부분이 불필요해지거나 변경이 필요하다. 지속적인 측정과 개선이 핵심이다.
