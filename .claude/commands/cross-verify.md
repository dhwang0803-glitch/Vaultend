Claude Code가 생성한 산출물(plan, spec, 코드, PR)을 Codex를 통해 독립적으로 교차 검증한다. 자기 편향(self-bias)을 방지하기 위해 **작성자와 다른 모델이 검증**하는 것이 핵심이다. 인자: 검증 대상 유형 또는 파일 경로. 예: `/cross-verify plan`, `/cross-verify docs/specs/auth.md`, `/cross-verify diff`

> **사전 요구사항**: Codex CLI (`npm install -g @openai/codex`) 설치 권장. CLI 미설치 시 MCP 폴백 사용. 설정 가이드: `docs/context/cross-verify-guide.md`

> **자동 트리거**: `/pr-report` 실행 시 PR 생성 후 교차 검증 여부를 자동으로 묻는다. 코드 변경이 포함된 PR은 실행 권장. 수동으로도 언제든 실행 가능.

---

## 원칙

1. **같은 모델이 만든 것을 같은 모델이 검증하지 않는다.** Claude가 작성한 산출물은 Codex가 검증하고, Codex가 수정한 것은 Claude가 재검증한다.
2. **같은 세션에서 자기 코드를 평가하지 않는다.** 자기 편향이 발생해 "잘했습니다"만 반복한다.
3. **검증 결과에서 불일치(disagreement)가 있으면 사람이 최종 판단한다.** 어느 모델도 절대적 권위를 갖지 않는다.

---

## Step 0. 검증 대상 판별

인자로 유형을 받거나 자동 판별한다:

| 인자 | 대상 | 수집 파일 |
|------|------|----------|
| `plan` | 실행 계획 | `docs/specs/plan/*.md` 중 최근 변경 |
| `spec` | 모듈 설계 명세 | `docs/specs/<module>.md` |
| `code` | 구현 코드 | 현재 브랜치의 변경 파일 (`git diff --name-only`) |
| `diff` | PR diff | `git diff origin/development...HEAD` |
| `pr` | PR 전체 | diff + spec + plan 통합 검증 |
| 파일 경로 | 특정 파일 | 해당 파일 + 관련 spec/test |
| (생략) | 자동 판별 | 가장 최근 변경된 산출물 유형으로 추정 |

## Step 1. 컨텍스트 수집

검증 대상을 파악한다. Step 2에서 Codex CLI가 직접 파일 시스템에 접근하므로 **Claude가 diff를 미리 수집할 필요 없다.** 변경 파일 목록만 확인한다:

```bash
# 변경 파일 목록 확인 (PR 범위 파악용)
git diff --name-only origin/development...HEAD
git log --oneline origin/development...HEAD
```

## Step 2. Codex 검증 요청

우선순위에 따라 실행 방법을 선택한다:

| 우선순위 | 방법 | 장점 | 조건 |
|---------|------|------|------|
| **1순위** | CLI 직접 실행 | 파일 시스템 전체 접근, 컨텍스트 손실 없음 | `codex` CLI 설치됨 |
| **2순위** | MCP 도구 호출 | 자동화 가능 | MCP 설정됨 (컨텍스트 제한 있음) |
| **3순위** | 수동 모드 | 항상 가능 | 사용자가 외부에서 실행 |

### Step 2-a. CLI 직접 실행 (권장)

Claude가 Bash 도구로 `codex` CLI를 직접 실행한다. Codex가 로컬 파일 시스템에 직접 접근하므로 **컨텍스트 손실이 없다.**

#### code/diff/pr 검증

```bash
# Codex가 직접 git diff를 실행하고, 모든 파일을 읽을 수 있다.
# 타임아웃 600초 (리뷰에 수 분 소요될 수 있음)
codex review --base development
```

> `codex review --base`는 커스텀 프롬프트(`[PROMPT]`)와 동시 사용 불가. 기본 리뷰 기준으로 실행된다.

#### plan/spec 검증 (커스텀 기준 필요 시)

`codex review`는 커스텀 프롬프트와 `--base`를 동시에 쓸 수 없으므로, 범용 `codex exec` 모드를 사용한다:

```bash
codex exec "당신은 독립적인 코드 리뷰어입니다. 다른 AI가 작성한 설계 명세를 검증하세요.

검증 대상: docs/specs/<module>.md
참조: CLAUDE.md의 아키텍처 규칙

검증 기준:
1. 실현 가능성 — 이대로 구현하면 동작하는 코드가 나오는가?
2. 완전성 — 빠진 단계, 엣지 케이스가 있는가?
3. 아키텍처 정합성 — CLAUDE.md 규칙을 위반하는가?
4. 모호성 — 구현자가 해석을 달리할 수 있는 서술이 있는가?

각 기준에 PASS/WARN/FAIL + 근거 + 수정 제안.
한국어로 응답하세요."
```

#### CLI 실행 시 주의사항

- **타임아웃**: Codex 리뷰는 2~5분 소요될 수 있다. Bash 도구 호출 시 `timeout: 600000` (10분)을 설정한다.
- **출력 크기**: 리뷰 결과가 길면 잘릴 수 있다. 잘린 경우 저장된 파일에서 전체 결과를 읽는다.
- **인증**: `~/.codex/auth.json`에 유효한 API 키가 있어야 한다. 실패 시 `docs/context/cross-verify-guide.md`의 트러블슈팅 참조.

### Step 2-b. MCP 도구 호출 (CLI 미설치 시 폴백)

Codex CLI가 설치되어 있지 않은 환경에서는 MCP 도구를 사용한다.

> ⚠️ **MCP 모드의 한계**: Codex MCP 에이전트는 셸 명령을 실행하지 않고 파일 시스템에 접근하지 않는다. Claude가 diff를 수집하여 프롬프트에 직접 포함시켜야 하므로 **컨텍스트 손실이 발생**한다. 가능하면 Step 2-a를 사용하라.

`mcp__codex-cli__codex` 도구를 사용한다 (`review` 도구는 `--base`와 커스텀 프롬프트 동시 사용 불가):

| 옵션 | 값 | 설명 |
|------|-----|------|
| `prompt` | 검증 프롬프트 + **diff 내용을 직접 포함** | Codex가 파일을 읽을 수 없으므로 |
| `model` | `o4-mini` 또는 생략 | 검증 모델 |
| `sandbox` | `read-only` | 파일 수정 방지 |

MCP 모드에서는 Claude가 먼저 diff를 수집해야 한다:
```bash
git diff origin/development...HEAD   # 전체 diff 수집
```

수집한 diff를 아래 프롬프트에 포함하여 `mcp__codex-cli__codex` 호출:
```
당신은 독립적인 코드 리뷰어입니다. 다른 AI가 작성한 코드 변경을 검증하세요.

## 검증 기준
1. 정확성 2. 하드코딩/회피 패턴 3. 아키텍처 위반 4. 보안 5. spec 정합성

## 코드 변경 (diff)
{수집한 diff 내용}

## 출력 형식
심각도(CRITICAL/HIGH/MEDIUM/LOW) + 파일명 + 근거 + 수정 제안.
마지막에 종합 판정(PASS/WARN/FAIL). 한국어로 응답.

**주의: 제공된 diff에 없는 파일의 존재 여부를 추측하지 마세요.**
```

### Step 2-c. 수동 모드 (MCP도 미설정 시)

모든 자동화 수단이 불가능한 경우:

1. 위 프롬프트를 **파일로 저장** (`docs/specs/plan/cross-verify-prompt-{timestamp}.md`)
2. 사용자에게 안내:
   ```
   Codex CLI와 MCP 모두 사용할 수 없습니다.
   검증 프롬프트가 저장되었습니다:
     docs/specs/plan/cross-verify-prompt-{timestamp}.md

   수동 검증 방법:
   1. 위 파일 내용을 Codex/ChatGPT에 붙여넣기
   2. 결과를 이 세션에 다시 붙여넣기

   자동화 설정: docs/context/cross-verify-guide.md
   ```
3. 사용자가 외부 검증 결과를 붙여넣으면 Step 3으로 진행.

## Step 3. 사실 확인 + 결과 비교

> ⚠️ **Codex는 파일 시스템에 접근할 수 없다.** diff에 포함되지 않은 파일(`.gitignore`, `package.json` 등)의 존재 여부를 추측하여 오탐을 낼 수 있다. Claude는 Codex 지적 중 파일 존재/패키지명/설정값 관련 주장을 **반드시 사실 확인**한 뒤 분류한다.

### 3-0. 사실 확인 (Claude가 실행)

> CLI 직접 실행(Step 2-a) 시: Codex가 파일에 직접 접근하므로 오탐 확률이 낮다. 그래도 의심스러운 지적은 확인한다.
> MCP 모드(Step 2-b) 시: Codex가 파일을 못 보므로 오탐 확률이 높다. **모든 지적을 검증**해야 한다.

Codex 결과를 받은 후, 각 지적에 대해:
- 파일 존재 여부 주장 → `Glob` 또는 `Grep`으로 확인
- 패키지명/버전 주장 → `npm view` 또는 `pip show`로 확인
- 설정값 주장 → 해당 파일을 `Read`로 직접 확인

확인 결과에 따라 각 지적을 **유효/오탐**으로 분류한다.

### 3-1. 불일치(Disagreement) 추출

| 항목 | Claude 판단 | Codex 판단 | 심각도 | 사람 판단 필요 |
|------|-----------|-----------|--------|--------------|

### 3-2. 합의(Agreement) 요약

양쪽 모델이 동의하는 부분은 신뢰도가 높다. 간략히 요약.

### 3-3. Codex 단독 지적 (사실 확인 후 유효/오탐 분류)

Claude가 놓친 부분을 Codex가 발견한 경우. **유효한 단독 지적이 가장 가치 있다.** 오탐은 별도 표기하여 파이프라인 개선 자료로 활용한다.

### 3-4. 종합 판정

```
## 교차 검증 결과

- 검증 대상: {유형} — {파일/범위}
- 검증 방법: {CLI 직접 실행 / MCP / 수동}
- 검증 모델: Codex (o4-mini)
- 불일치 항목: N건 (CRITICAL: n, HIGH: n, MEDIUM: n)
- Codex 단독 지적: N건 (유효: n, 오탐: n)
- 합의 항목: N건

### 사람이 결정해야 할 항목
1. {불일치 항목 — 양쪽 근거 제시}

### 권고 조치
- [ ] {수정 필요 항목}
- [ ] {확인 필요 항목}
```

## Step 4. 보고서 저장

검증 보고서를 `docs/specs/plan/cross-verify-{target}-{date}.md`에 저장한다. 이 기록은 하네스 개선(`/session-retro`)의 입력이 된다.

---

## 교차 검증 파이프라인 전체 흐름

```
Claude Code 산출물 생성
    ↓
/cross-verify [target]
    ↓
Step 0. 검증 대상 판별
    ↓
Step 1. 변경 파일 목록 확인 (PR 범위 파악)
    ↓
Step 2. Codex 검증 실행 (우선순위 순서로 시도)
    ┌─────────────────────────────────────────────────────┐
    │ 2-a. CLI 직접 실행 (권장)                            │
    │      codex review --base main                       │
    │      → Codex가 직접 파일 접근, 컨텍스트 손실 없음     │
    │                                                     │
    │ 2-b. MCP 도구 호출 (CLI 미설치 시 폴백)              │
    │      Claude가 diff 수집 → 프롬프트에 포함             │
    │      → 컨텍스트 손실 있음, 오탐 주의                  │
    │                                                     │
    │ 2-c. 수동 모드 (모두 불가 시)                         │
    │      프롬프트 파일 저장 → 사용자가 외부에서 실행       │
    └─────────────────────────────────────────────────────┘
    ↓
Step 3-0. 사실 확인 (CLI 시 경량, MCP 시 전수 검증)
    ↓
Step 3. 불일치/합의/단독지적(유효·오탐) 분류
    ↓
사용자에게 보고 (사람이 최종 판단)
    ↓
보고서 저장 → /session-retro 입력
```

---

## ⛔ 금지

- Codex 검증 결과를 Claude가 임의로 무시하거나 반박하지 않는다. 불일치는 사람에게 양쪽 근거를 제시한다.
- Codex 결과가 없는 상태에서 "검증 완료"를 보고하지 않는다.
- 같은 세션에서 Claude가 작성한 코드를 Claude 자신이 "교차 검증"하지 않는다 — 그것은 자기 평가이지 교차 검증이 아니다.
