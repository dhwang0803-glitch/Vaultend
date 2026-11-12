릴리즈 전 체크리스트 검증 → 로컬 Obsidian 배포 → 사용자 확인 → 머지 → 태그 → 배포까지 수행한다. `/pr-report` 완료 후 자동 체인되거나, 독립 실행 가능.

---

## 전제 조건

- PR이 이미 생성되어 있어야 한다 (`/pr-report`에서 생성)
- 교차 검증이 완료되어 있어야 한다 (P1/P2 수정 포함)

---

## Step 0. 현재 상태 확인

```bash
git branch --show-current
gh pr list --head development --state open --limit 1
```

열린 PR이 없으면 → "PR이 없습니다. `/pr-report`를 먼저 실행하세요." 후 **중단**.

---

## Step 1. 버전 결정

사용자에게 버전 bump 유형을 묻는다:

```
릴리즈 버전을 선택하세요:
1. patch (X.Y.Z+1) — 버그 수정, 소규모 개선
2. minor (X.Y+1.0) — 새 기능 추가
3. 직접 입력
```

현재 버전은 `manifest.json`에서 읽는다.

---

## Step 2. Pre-release 체크리스트 (자동 검증 — 전체 통과 필수)

아래 항목을 **모두 자동으로 검증**한다. 하나라도 실패하면 **릴리즈 중단**, 실패 항목 보고.

### 2-1. 버전 정합성

```bash
# 세 파일의 버전이 모두 동일한지 확인
node -e "
  const p = require('./package.json').version;
  const m = require('./manifest.json').version;
  const v = require('./versions.json');
  const match = p === m && v[p] !== undefined;
  console.log(match ? 'PASS' : 'FAIL: package=' + p + ' manifest=' + m + ' versions=' + (v[p] ? 'OK' : 'MISSING'));
  process.exit(match ? 0 : 1);
"
```

실패 시: 누락된 파일의 버전을 업데이트하라고 안내.

### 2-2. CHANGELOG 항목 존재

```bash
# 새 버전의 CHANGELOG 항목이 있는지 확인
grep -c "## \[{NEW_VERSION}\]" CHANGELOG.md
```

실패 시: CHANGELOG.md에 해당 버전 항목을 추가하라고 안내.

### 2-3. What's New 항목 존재

```bash
# WhatsNewModal.ts에 새 버전 항목이 있는지 확인
grep -c "version: '{NEW_VERSION}'" src/ui/WhatsNewModal.ts
```

실패 시: WhatsNewModal.ts CHANGELOG 배열에 새 버전 항목을 추가하라고 안내.

### 2-4. What's New i18n 키 존재

```bash
# 새 버전의 i18n 키가 EN/KO 양쪽에 있는지 확인
# 버전 번호에서 점 제거 (1.0.21 → 1021)
EN_COUNT=$(grep -c "whatsNew.v{VERSION_NODOT}" src/i18n/locales/en.ts)
KO_COUNT=$(grep -c "whatsNew.v{VERSION_NODOT}" src/i18n/locales/ko.ts)
echo "EN: $EN_COUNT, KO: $KO_COUNT"
```

실패 시: 누락된 locale 파일에 What's New 키를 추가하라고 안내.

### 2-5. i18n 전체 키 일치

```bash
# EN과 KO의 전체 키 수가 동일한지 확인
node -e "
  const en = Object.keys(require('./src/i18n/locales/en.ts').default || {});
  const ko = Object.keys(require('./src/i18n/locales/ko.ts').default || {});
" 2>/dev/null
# 또는 grep 기반:
EN_KEYS=$(grep -cE "^\s+'" src/i18n/locales/en.ts)
KO_KEYS=$(grep -cE "^\s+'" src/i18n/locales/ko.ts)
[ "$EN_KEYS" = "$KO_KEYS" ] && echo "PASS ($EN_KEYS)" || echo "FAIL: en=$EN_KEYS ko=$KO_KEYS"
```

### 2-6. 빌드 · 린트 · 테스트

```bash
npm run lint
npx tsc -noEmit -skipLibCheck
npm run build
npm run test 2>/dev/null || true  # 테스트 없으면 skip
```

### 2-7. 체크리스트 보고

```
## Pre-release 체크리스트 (v{NEW_VERSION})

| # | 항목 | 결과 |
|---|------|------|
| 1 | 버전 정합성 (package/manifest/versions) | ✅/❌ |
| 2 | CHANGELOG 항목 | ✅/❌ |
| 3 | What's New 항목 | ✅/❌ |
| 4 | What's New i18n (EN/KO) | ✅/❌ |
| 5 | i18n 전체 키 일치 | ✅/❌ |
| 6 | 빌드 통과 | ✅/❌ |
| 7 | 린트 통과 | ✅/❌ |

전체 통과: 릴리즈 진행 가능
```

**하나라도 ❌이면 릴리즈 중단.** 실패 항목을 수정한 뒤 `/release`를 다시 실행.

---

## Step 3. 로컬 Obsidian 배포 (스테이징)

체크리스트 전체 통과 후:

```bash
# 빌드 산출물을 로컬 Obsidian vault에 복사
cp main.js manifest.json styles.css {OBSIDIAN_VAULT_PATH}/.obsidian/plugins/Vaultend/
```

> vault 경로는 사용자에게 확인. 이전에 사용한 경로가 있으면 재사용.

사용자에게 안내:

```
로컬 Obsidian에 v{NEW_VERSION}을 배포했습니다.
Obsidian을 재시작하고 아래를 확인해주세요:

1. 플러그인이 정상 로드되는지
2. What's New 모달이 올바르게 표시되는지
3. 변경된 기능이 정상 동작하는지
4. (권장) 기존 기능 회귀 — 직전 릴리즈 빌드와 같은 시나리오·설정으로 결과 비교

확인 완료 후 "릴리즈해줘"라고 말씀해주세요.
```

#### 회귀 비교 기준 (안내 4번)

| 항목 | 기준 |
|------|------|
| 직전 릴리즈 | GitHub 최신 Release의 에셋(`gh release download <직전 태그> -p main.js -p manifest.json -p styles.css`) |
| 같은 입력 | 같은 테스트 vault(매 실행 전 백업본으로 복원) + 같은 `data.json` 시나리오(프로바이더·모델·언어·주요 설정). API 키는 환경변수로만 주입하고 종료 후 제거 |
| 비교 대상 | 플러그인 로드·콘솔 오류, What's New·설정 화면, 노트 정리·폴더 정리·태그 정리 결과(제안 태그·링크·그룹), 저장된 설정값 |
| 같은 결과로 보는 차이 | LLM 비결정성 범위(토큰 수, 점수, 동등한 표현의 태그)와 이번 릴리즈에서 의도한 변경 |
| 회귀로 보는 차이 | 직전 릴리즈에서 성공한 시나리오의 실패·오류, 정상 경로 결과의 의도치 않은 변화 |

> 자동화 도구 정식화는 기술 부채 TD-5(`docs/context/tech-debt.md`, PR #268에서 추가)에서 추적한다.

**사용자 확인 없이 절대 다음 단계로 진행하지 않는다.**

---

## Step 4. 커밋 · Push · PR 머지

사용자가 확인 완료를 알리면:

```bash
# 미커밋 변경이 있으면 커밋 (version bump 등)
git add package.json manifest.json versions.json CHANGELOG.md
git commit -m "chore: bump version to {NEW_VERSION}"
git push origin development

# PR 머지 (merge commit, squash 금지)
gh pr merge {PR_NUMBER} --merge
```

---

## Step 5. 태그 · 릴리즈

```bash
git fetch origin
git tag {NEW_VERSION} origin/main
git push origin {NEW_VERSION}
```

> 태그 형식: `X.Y.Z` (v 접두사 금지 — CI 매칭 실패 방지)

태그 push → `release.yml` 워크플로우가 자동으로 GitHub Release 생성.

---

## Step 6. development ↔ main 동기화

```bash
git merge origin/main --ff-only
git push origin development
```

---

## Step 7. 릴리즈 확인

```bash
gh release view {NEW_VERSION} --json tagName,assets,createdAt
```

에셋 3개(main.js, manifest.json, styles.css) 존재 확인 후 완료 보고.

---

## ⛔ 금지 규칙

1. **체크리스트 실패 시 릴리즈 진행 금지** — 반드시 수정 후 재실행
2. **사용자 로컬 확인 없이 머지/태그 금지** — Step 3 확인 필수
3. **태그 삭제 후 재생성 금지** — 문제 발견 시 새 버전으로 bump
4. **v 접두사 태그 금지** — `1.0.21` (O), `v1.0.21` (X)
