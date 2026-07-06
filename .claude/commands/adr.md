새 ADR(Architecture Decision Record)을 템플릿에서 생성하고 `docs/context/decisions.md` 인덱스에 한 줄을 추가한다. 인자: 결정 제목. 예: `/adr Redis를 세션 저장소로 채택`

> ADR/위키는 **`docs` 브랜치 전용**이다. 코드 브랜치에서 이 커맨드를 실행하지 말 것 — 먼저 `docs` 브랜치로 전환(없으면 생성)한다.

---

## Step 0. docs 브랜치 확인 (필수)

```bash
git branch --show-current
git status --porcelain docs/context/
```

- 현재 브랜치가 `docs`가 아니면 → 사용자에게 알리고 `git checkout docs`(없으면 `git checkout -b docs`) 안내 후 진행 여부 확인.
- 코드 변경이 섞여 있으면 중단 (ADR은 위키 전용 커밋이어야 함).

## Step 1. 다음 ADR 번호 산정

```bash
ls docs/context/adr/ | grep -E "^ADR-[0-9]{4}" | sort | tail -1
```

마지막 번호 + 1을 4자리 zero-pad (`0001`, `0002`, …). 0000은 템플릿이므로 1부터.
slug는 제목을 소문자-하이픈으로 변환 (영문 권장, 한글 제목이면 핵심 키워드 영문 slug).

## Step 2. ADR 파일 생성

`docs/context/adr/ADR-0000-template.md`를 복사해 `docs/context/adr/ADR-NNNN-<slug>.md`로 만들고:

- 제목, **Status: Proposed**, **Date: 오늘(YYYY-MM-DD)**, Deciders, Tags 채우기
- Context / Decision / Consequences(Positive·Trade-offs·Follow-ups) / Alternatives Considered / References 작성
- 사용자와 대화로 확정된 내용만 적는다. 불명확하면 TODO로 남기고 묻는다.

## Step 3. 인덱스 갱신

`docs/context/decisions.md`의 `## Index` 표에 행 추가:

```
| NNNN | [<제목>](./adr/ADR-NNNN-<slug>.md) | Proposed | YYYY-MM-DD |
```

> 기존 결정을 **뒤집는** ADR이면: 원본 ADR의 Status를 `Superseded by ADR-NNNN`으로 바꾸고
> 인덱스의 원본 행 Status도 `Superseded`로 갱신한다. **원본 삭제 금지.**

## Step 4. 영향 점검 (선택)

이 결정이 MAP/architecture 위키 갱신을 유발하는지 판단:
- 새 최상위 폴더/배치 규칙 → `MAP.md`
- 데이터 흐름/실행 모드/계약 형상 변경 → `architecture.md`

필요하면 같은 `docs` 브랜치 커밋에 함께 반영한다.

## Step 5. 커밋 (사전 확인 필수)

1. 생성/변경 파일 목록을 **채팅에 먼저 제시**한다.
2. 사용자 확인 후 커밋:
   ```bash
   git add docs/context/
   git commit -m "docs(adr): ADR-NNNN <제목>"
   ```
3. push/PR은 사용자가 명시할 때만. `docs` 브랜치 → PR은 코드 PR과 별도로 올린다.
