PRD를 입력받아 Clean Architecture + 모노레포로 설계하고, 기능별 모듈로 분해해 **모듈별 spec(SSOT)** 을 작성하고, 모노레포 골격을 스캐폴딩한다. 인자: PRD 파일 경로 또는 PRD 텍스트. 예: `/spec-design docs/PRD.md` 또는 `/spec-design <붙여넣은 PRD>`

> 이 커맨드는 **상류 설계**(PRD→spec)다. 구현은 이후 모듈별로 TDD(`_agent_templates/ORCHESTRATOR`)로 진행한다.
> 각 단계 산출물을 **채팅에 먼저 제시하고 사용자 확인을 받은 뒤** 다음 단계로 넘어간다. 한 번에 끝까지 자동 생성하지 않는다.

---

## Step 0. PRD 수집·정규화

1. 인자가 파일 경로면 읽고, 텍스트면 그대로 사용. 없으면 `docs/PRD.md`를 찾고, 그래도 없으면 사용자에게 요청.
2. PRD에서 다음을 추출해 요약 제시: **목표 / 핵심 사용자 시나리오 / 기능 목록 / 비기능 요구(성능·보안·규모) / 외부 연동 / 데이터**.
3. 모호하거나 빠진 핵심(예: 인증 방식, 데이터 저장소, 배포 타깃)이 있으면 **여기서 질문**한다. 추측으로 설계하지 않는다.

## Step 1. 아키텍처 설계 (Clean Architecture + 모노레포)

1. **레이어 매핑**: 기능들을 Frontend / Core API / Domain / Persistence / Foundation 레이어로 배치.
2. **공유 스키마 식별**: 둘 이상 모듈이 공유할 엔티티/VO/Enum을 골라 `packages/<shared_schemas>`(SSOT)에 둔다.
3. **기술 스택 확정**: `CLAUDE.md`/`ai-native-kit.toml`의 스택을 기본으로, PRD 요구에 맞게 조정. 트레이드오프 있는 선택은 ADR 후보로 표시.
4. 산출: 레이어 다이어그램(텍스트) + 경계/계약 표 초안. → **사용자 확인.**

## Step 2. 모듈 분해 (기능 → 모듈)

1. 기능을 **응집도 높은 모듈**로 분해. 각 모듈은 단일 책임. 모듈/서비스 후보 표 작성:

   | 모듈/서비스 | 레이어 | 책임 | 핵심 use case | 주요 의존 |
   |------------|--------|------|--------------|-----------|

2. **의존성 방향 검증**: `packages ← modules ← services`, `modules → services` 금지, 모듈 간 교차 import는 상대 `domain/ports`·`domain/entities`만. 위반 설계면 재분해.
3. 모듈 간 **Port → Adapter** 소유권 초안(누가 ABC를 소유하고 누가 구현하는지). → **사용자 확인.**

## Step 3. 모듈별 spec 생성 (SSOT)

확정된 각 모듈에 대해 `docs/specs/SPEC_TEMPLATE.md`를 기반으로 `docs/specs/<module>.md` 작성:

- 공유 스키마 import 목록 / 계층별 클래스(entities·VO·services·ports → use_cases → adapters) / 환경변수 / 의존성 그래프 / 목표 디렉토리 / 공개 API
- **클래스 관계 다이어그램 필수**: 클래스 간 상속/구현/합성/의존 관계를 텍스트 기반으로 기술. 이 다이어그램이 구현의 청사진이다.
- **적용 디자인 패턴 명시**: Factory, Strategy, Facade 등 적용할 패턴과 적용 근거를 표로 기록. 패턴이 불필요하면 "해당 없음" 명시.
- PRD로 확정 가능한 부분만 채우고, 미정은 `TODO`로 남긴다 (환각 금지).
- 모듈이 많으면 한 번에 다 쓰지 말고 **레이어/핵심 모듈부터** 순차 작성하며 확인받는다.

> 큰 모듈은 `docs/specs/plan/PLAN_TEMPLATE.md`로 Phase 계획도 함께 만들 수 있다.

## Step 4. 모노레포 스캐폴딩

확정된 구조로 디렉토리 골격을 생성한다 (소스 구현은 비움 — TDD로 채울 것):

```
packages/<shared_schemas>/        # 공유 타입 SSOT
modules/<module>/
├── domain/{entities,value_objects,services,ports}/
├── application/use_cases/
├── adapters/
├── tests/{unit/domain,unit/application,integration}/
└── README.md                     # _module_templates/README.md 기반, 모듈에 맞게 채움
services/<service>/                # Composition Root
```

- 각 모듈 `README.md`는 `_module_templates/README.md`를 복사해 모듈 공개 API로 채운다.
- 빈 디렉토리는 `.gitkeep` 추가.
- **루트나 모듈 루트에 소스 파일 직접 생성 금지** (계층 폴더 안에만).

## Step 5. 위키 동기화 (docs 브랜치 주의)

- 초기 설계면 `docs/context/MAP.md`(최상위 구조)·`architecture.md`(레이어/흐름)를 이번 설계로 채운다.
- 트레이드오프 있던 결정은 `/adr`로 ADR 작성.
- ⚠️ `docs/context/`는 **`docs` 브랜치 전용**이다. 코드 스캐폴딩 커밋과 분리한다.
  (`docs/specs/`는 코드와 함께 가도 된다 — 구현 SSOT이므로.)

## Step 6. 마무리 (사전 확인 필수)

1. 생성/변경 파일 전체 목록 + 모듈 의존성 그래프를 **채팅에 제시**.
2. 사용자 확인 후 커밋 (위키는 별도 `docs` 브랜치). push/PR은 명시할 때만.
3. 다음 단계 안내: 모듈별로 `feature/<module>` 브랜치 생성(→ post-checkout가 agents/ 스캐폴딩) 후 `ORCHESTRATOR`로 TDD 시작.

---

## 원칙

- **추측 금지**: PRD에 없는 계약(필드·시그니처)은 만들어내지 말고 TODO + 질문.
- **점진적 확인**: Step 1~4 각각 사용자 확인 후 진행. 대규모 설계를 한 응답에 쏟지 않는다.
- **의존성 방향이 곧 검수 기준**: 분해가 Clean Architecture 방향을 위반하면 spec을 쓰기 전에 재설계.
