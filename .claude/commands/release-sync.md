`development` → `release` 동기화(staging 배포 트리거) PR을 **충돌 없이** 생성한다. 인자(선택): 동기화 요약 메모. 예: `/release-sync` 또는 `/release-sync 인증 시리즈`

---

## 왜 이 커맨드가 필요한가 (반복 충돌의 정체)

release-sync PR을 **squash 머지**하면 release에 `development` 히스토리에 없는 단일 커밋만
쌓인다. 그 결과 `merge-base(release, development)`가 최초 baseline으로 고정되고, 다음
sync는 baseline부터 통째로 merge 표면이 잡혀 **거대 충돌**이 난다. 이 커맨드는 `-s ours`로
release를 `development` 트리로 덮어쓰면서 release를 parent로 편입해 매번 충돌 0으로 만든다.

---

## Step 0. 사전 점검 (덮어쓰기 안전성 — 필수)

```bash
git fetch origin development release
# release에만 있는 커밋 = 덮어쓸 때 사라지는 것. 전부 sync 잔재여야 안전.
git log --oneline origin/development..origin/release
```

- 위 목록이 **전부 `chore(release-sync)` 잔재**면 `-s ours` 안전.
- **진짜 hotfix(release 직접 수정)가 1개라도 보이면 중단** → 먼저 `development`로 cherry-pick 후 진행.
- 실제 배포 규모는 커밋 수가 아닌 **트리 diff**로 판단:
  ```bash
  git diff --stat origin/release origin/development | tail -1
  ```

## Step 1. 충돌 없는 sync 브랜치 생성

```bash
DATE=<오늘 YYYY-MM-DD>
git checkout -B chore/release-sync-$DATE origin/development
# release를 -s ours로 머지: 트리는 development 그대로, release는 parent로만 편입 (충돌 0)
git merge -s ours --no-edit -m "chore(release-sync): development → release 동기화 ($DATE)" origin/release
# 검증: 트리가 development와 완전히 동일해야 함
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse origin/development^{tree})" ] && echo "tree OK" || echo "FAIL"
```

## Step 2. PR 본문 작성

본문은 파일로 작성(백틱·`$()` shell 평가 방지). 아래 블록 포함:

1. **범위**: 트리 diff 규모 + 주요 머지 PR 번호 (커밋 수 아닌 트리 기준).
2. **⚠️ 재배포 effect**: 공유 스키마 버전이 올랐으면 소비 서비스 재배포 필요 명시. env/secret 신규는 인프라 apply 필요.
3. **⛔ 수동 작업**: 시드/마이그레이션 등 CI 자동화가 없는 수동 절차가 있으면 명시. 없으면 "없음" 명시.
4. **머지 방법 권고**: 가능하면 **merge commit(스쿼시 금지)** — 그래야 `development`가 release의 조상이 돼 다음 sync baseline 충돌이 끊긴다.

## Step 3. 생성 (push + PR — 사전 확인 필수)

1. Step 0~2 결과(안전성 판정 + 트리 diff 규모 + 본문 초안)를 **채팅에 먼저 제시**.
2. 사용자 확인 후:
   ```bash
   git push -u origin chore/release-sync-$DATE
   gh pr create --base release --head chore/release-sync-$DATE \
     --title "chore(release-sync): development → release 동기화 ($DATE)" --body-file <file>
   ```
3. mergeable 확인: `gh pr view <N> --json mergeable -q .mergeable` → **MERGEABLE**(UNSTABLE은 CI 진행중일 뿐). CONFLICTING이면 Step 0 가정이 깨진 것 → 재점검.

> 머지 클릭은 사용자 권한 — Claude는 절대 머지하지 않는다.
