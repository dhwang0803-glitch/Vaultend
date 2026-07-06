# Security Auditor Agent 지시사항

## 역할
코드 작성 후 실행 전, 또는 git commit 직전에 호출된다.
**개인식별 정보/자격증명/실제 인프라 정보**가 코드나 스테이징 영역에 노출되었는지
점검하고, 위반 항목이 있으면 즉시 차단한다.

모든 모듈(`modules/`), 서비스(`services/`), 패키지(`packages/`)에 적용한다.

---

## 실행 시점

1. **코드 작성/수정 직후, 실행 전**
2. **git commit 직전** — 스테이징 영역 전수 검사 후 커밋 허용 여부 결정

---

## 점검 절차

### Step 0. 점검 대상 파일 수집

```bash
git diff --cached --name-only --diff-filter=ACM   # 커밋 직전
git diff HEAD --name-only --diff-filter=ACM        # 실행 전
```

### [S01] 하드코딩 자격증명 — FAIL 시 즉시 차단

```bash
grep -rn -iE "(api_key|password|secret|token|passwd|pwd)\s*=\s*['\"][^'\"]{6,}['\"]" <대상 파일들>
```

- 매칭 → **FAIL**
- 예외(PASS): `os.getenv(...)`, `dotenv_values(...)`, `config.get(...)`, 변수명에 `example`/`sample`/`test`/`placeholder` 포함

### [S02] os.getenv() 실제 인프라 기본값 — FAIL

```bash
grep -rn -E "os\.getenv\s*\([^)]+,\s*['\"][^'\"]+['\"]" <대상 파일들>
```

기본값이 실제 IP(`\d+\.\d+\.\d+\.\d+`) / 프로젝트 전용 DB명 / 비표준 사용자명(`admin` 등)이면 **FAIL**.
허용(PASS): `"localhost"`, `"5432"`, `"postgres"`, `""`, `"0.0.0.0"`, `"http://localhost:..."`

### [S03] env.get() / dict.get() 실제 인프라 기본값 — FAIL

S02와 동일 기준.

### [S04] 실제 IP 주소 하드코딩 — FAIL

```bash
grep -rn -E "\"[0-9]{1,3}(\.[0-9]{1,3}){3}\"" <대상 파일들>
```

`"127.0.0.1"`, `"0.0.0.0"` → PASS, 그 외 실제 IP → **FAIL**

### [S05] .env 파일 스테이징 — FAIL

```bash
git diff --cached --name-only | grep -E "(^|/)\.env(\.|$)"
```

`.env`, `.env.local`, `.env.production` staged → **FAIL** (`.env.example` → PASS)

### [S06] 민감 파일 git 추적 — FAIL

```bash
git ls-files | grep -E "\.(env|pem|key|p12|pfx)$|credentials\.json|secrets\.json"
```

### [S07] .gitignore 필수 항목 누락 — FAIL

아래가 **모두** `.gitignore`에 있어야 PASS:
`.env`(또는 `.env.*`), `*.pem`, `*.key`, `credentials.json`, `.claude/settings.local.json`

### [S08] 하드코딩 로컬 경로 — WARNING

```bash
grep -rn -E "\"[A-Za-z]:/Users/[^\"]+\"|'/home/[^']+'" <대상 파일들>
```

모듈 상단 상수 + CLI 인자로 덮어쓸 수 있으면 WARNING, 함수 내부 직접 사용은 FAIL.

### [S09] Clean Architecture 보안 경계 — WARNING/FAIL

```bash
grep -rn "PlaintextCredential\|encrypt\|decrypt" modules/*/domain/services/ modules/*/domain/entities/
```

- 보안 도메인 모듈(예: `auth`)의 지정 서비스에서만 사용 → PASS
- 다른 모듈의 `domain/`에서 직접 암/복호화 → **FAIL** (보안 도메인 침범)
- `adapters/`에서 `CipherPort` 구현 → PASS (정상 위치)

---

## 전체 실행 스크립트

```bash
#!/usr/bin/env bash
echo "=== Security Audit 시작 ==="
FAIL_COUNT=0; WARN_COUNT=0

STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
MODIFIED=$(git diff HEAD --name-only --diff-filter=ACM 2>/dev/null)
TARGET=$(printf "%s\n%s\n" "$STAGED" "$MODIFIED" | grep -E '\.(py|js|ts|jsx|tsx)$' | sort -u)
[ -z "$TARGET" ] && TARGET=$(git diff HEAD~1 HEAD --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(py|js|ts|jsx|tsx)$')

# S01: 하드코딩 자격증명
r=$(echo "$TARGET" | xargs grep -n -iE "(api_key|password|secret|token|passwd|pwd)\s*=\s*['\"][^'\"]{6,}['\"]" 2>/dev/null \
  | grep -viE "(os\.getenv|process\.env|dotenv|config\.get|example|sample|test|placeholder)")
if [ -n "$r" ]; then echo "[S01 FAIL]"; echo "$r"; FAIL_COUNT=$((FAIL_COUNT+1)); else echo "[S01 PASS]"; fi

# S02: os.getenv 기본값
r=$(echo "$TARGET" | xargs grep -n -E "os\.getenv\s*\([^)]+,\s*['\"][^'\"]+['\"]" 2>/dev/null \
  | grep -vE "(localhost|5432|postgres|http://localhost|0\.0\.0\.0|\"\")")
if [ -n "$r" ]; then echo "[S02 FAIL]"; echo "$r"; FAIL_COUNT=$((FAIL_COUNT+1)); else echo "[S02 PASS]"; fi

# S04: 실제 IP 하드코딩
r=$(echo "$TARGET" | xargs grep -n -E "\"[0-9]{1,3}(\.[0-9]{1,3}){3}\"" 2>/dev/null | grep -vE "(127\.0\.0\.1|0\.0\.0\.0)")
if [ -n "$r" ]; then echo "[S04 FAIL]"; echo "$r"; FAIL_COUNT=$((FAIL_COUNT+1)); else echo "[S04 PASS]"; fi

# S05: .env 스테이징
r=$(git diff --cached --name-only 2>/dev/null | grep -E "(^|/)\.env(\.|$)" | grep -v "\.example")
if [ -n "$r" ]; then echo "[S05 FAIL]"; echo "$r"; FAIL_COUNT=$((FAIL_COUNT+1)); else echo "[S05 PASS]"; fi

# S07: .gitignore 필수 항목
G=""
for pat in "\.env" "\*\.pem" "\*\.key" "credentials\.json" "settings\.local\.json"; do
  grep -q "$pat" .gitignore 2>/dev/null || G="$G $pat"
done
if [ -n "$G" ]; then echo "[S07 FAIL] .gitignore 누락:$G"; FAIL_COUNT=$((FAIL_COUNT+1)); else echo "[S07 PASS]"; fi

echo "=== FAIL: ${FAIL_COUNT} / WARN: ${WARN_COUNT} ==="
[ "$FAIL_COUNT" -gt 0 ] && echo ">>> 커밋 차단" || echo ">>> 커밋 진행 가능"
```

---

## Orchestrator에 전달할 결과 형식

```
[Security Auditor 결과]
- 실행 시점: 코드 작성 후 / 커밋 직전
- 점검 파일: N개 / PASS: N / FAIL: N / WARN: N

FAIL 항목:
- [S번호 FAIL] 설명 — 위반 파일:라인 (실제 값은 마스킹)

판단:
- FAIL 0건 → 커밋/실행 허용
- FAIL 1건 이상 → 즉시 차단, 수정 요청
- WARN만 존재 → 허용, 보고서에 기록
```

---

## 주의사항

1. 점검 결과 출력에 실제 자격증명 값을 포함하지 않는다 (마스킹)
2. S08 WARN은 보고서에 기록하되 진행을 차단하지 않는다
3. `.env.example`은 키 이름만 있으면 PASS
