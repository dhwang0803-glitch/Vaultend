# Architecture Decision Records (ADR)

> 설계 결정의 **배경과 맥락**을 남기는 문서. (`docs` 브랜치에서만 편집)
> 개별 ADR은 [`adr/`](./adr/) 하위에 `ADR-NNNN-slug.md`로 작성하고, 본 파일은 **인덱스**로만 사용한다.

## 작성 규칙

1. 새 결정은 `adr/ADR-NNNN-slug.md` 파일로 추가 (NNNN은 4자리 zero-padded, 1부터 순차).
   `/adr <제목>` 슬래시 커맨드로 템플릿 생성 + 인덱스 추가를 자동화할 수 있다.
2. 기존 결정을 **뒤집는** 경우: 원본 ADR에 `Superseded by ADR-NNNN` 표기 + 새 ADR 추가. **삭제 금지**.
3. 본 인덱스에 `# / Title / Status / Date` 한 줄을 추가한다.
4. 템플릿: [`adr/ADR-0000-template.md`](./adr/ADR-0000-template.md) 복사 후 작성.

## Status 정의

- `Proposed` — 검토 중
- `Accepted` — 적용됨 (현행)
- `Deprecated` — 더 이상 권장되지 않음 (대체 없음)
- `Superseded` — 다른 ADR로 대체됨

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| <!-- /adr 커맨드 또는 수동으로 행을 추가하세요. 예시: --> | | | |
| ~~0001~~ | ~~[결정 제목](./adr/ADR-0001-slug.md)~~ | ~~Accepted~~ | ~~YYYY-MM-DD~~ |

## 구현 결정 메모 (비-ADR)

> ADR로 올리기엔 가벼우나 **동작 반전**이라 drift 방지용으로 기록하는 항목.
> 형식: `- **<요약>** (YYYY-MM-DD, PR #NN): <무엇을 왜 바꿨는지 + 무엇을 supersede 하는지>`

(아직 없음)
