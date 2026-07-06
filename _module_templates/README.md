# <module> — 모듈 README

> 이 모듈을 **import하는 쪽**이 읽는 사용 계약(Public API) SSOT다.
> 상세 설계는 `docs/specs/<module>.md`, 결정 배경은 `docs/context/`.

## 역할

이 모듈이 무엇을 하는지 한두 문장.

## Quick Start (import 패턴)

```python
# 다른 모듈/서비스에서 이 모듈을 쓰는 표준 import
from <module>.application.use_cases import SomeUseCase
from <module>.domain.ports import SomePort        # ABC (구현은 외부에서 DI)
from <module>.domain.entities import Entity
```

> `adapters/`는 비공개다. 외부에서 직접 import 금지 — services의 Composition Root에서만 조립.

## 공개 API

| 심볼 | 위치 | 계약 |
|------|------|------|
| `SomeUseCase` | `application/use_cases` | `execute(arg) -> Result` |
| `SomePort` | `domain/ports` | ABC — 구현은 storage/adapters |
| `Entity` | `domain/entities` | 도메인 엔티티 |

## 의존 관계

- **Upstream (이 모듈이 의존)**: `common_schemas`, … (허용된 것만)
- **Downstream (이 모듈에 의존)**: services/…, …
- **Port → Adapter**: `SomePort` 구현은 `<storage>/repositories/` 또는 `adapters/`

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `SOME_KEY` | Y | … |

## 디렉토리

```
<module>/
├── domain/      (entities · value_objects · services · ports)
├── application/ (use_cases)
├── adapters/    (port 구현 — 비공개)
└── tests/       (unit/domain · unit/application · integration)
```
