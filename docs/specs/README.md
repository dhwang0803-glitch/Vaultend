# docs/specs — 구현 명세 (Implementation SSOT)

이 디렉토리는 **무엇을 어떻게 구현할지**의 단일 진실 공급원(SSOT)이다.
`docs/context`(위키 = "왜"와 결정)와 역할이 다르다.

| 디렉토리 | 무엇 | 갱신 규칙 |
|---------|------|----------|
| `docs/context/` | 위키 — 결정/아키텍처/지도 ("왜") | **`docs` 브랜치 전용** |
| `docs/specs/` | 구현 명세 — 모듈별 클래스/계약 ("무엇/어떻게") | **코드 PR과 함께 갱신** |

> spec과 코드가 어긋나면 그 자체가 결함이다. use case 시그니처·엔티티 필드·enum이
> 바뀌면 같은 PR에서 해당 spec을 갱신한다 (`/pr-3axis-review` 축 2가 점검).

## 구조

```
docs/specs/
├── README.md                  # 이 파일
├── <module>.md                # 모듈별 구현 명세 (SPEC_TEMPLATE.md 기반)
├── SPEC_TEMPLATE.md           # 모듈 명세 템플릿
└── plan/
    ├── PLAN_TEMPLATE.md       # 단계별 구현 계획 템플릿
    └── <module>-overview.md   # 모듈별 phase 계획
```

## 두 겹의 SSOT

1. **`docs/specs/<module>.md`** — 설계 SSOT. 계층별 클래스, 시그니처, 의존성, 환경변수,
   목표 디렉토리까지 못박는다. 구현 전에 작성하고, 구현하며 갱신한다.
2. **`modules/<module>/README.md`** — 사용 계약(Public API) SSOT. 다른 모듈이 이 모듈을
   import할 때 읽는다. spec의 "공개 API" 부분을 사용자 관점으로 요약.

## 새 모듈을 추가하려면

`/spec-design`으로 PRD에서 모듈을 분해하고 spec + 스캐폴드를 생성하거나, 수동이면:
1. `SPEC_TEMPLATE.md`를 복사해 `docs/specs/<module>.md` 작성
2. `modules/<module>/`에 3계층(domain/application/adapters) + README 생성
3. (선택) `plan/PLAN_TEMPLATE.md`로 단계별 계획 작성
