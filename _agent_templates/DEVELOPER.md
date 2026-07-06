# Developer Agent 지시사항

## 역할

Test Writer Agent가 작성한 테스트를 통과하는 최소한의 코드를 구현한다 (TDD Green).
과도한 설계나 불필요한 기능을 추가하지 않는다.

---

## 구현 원칙

1. **테스트 통과 최우선**: 현재 실패하는 테스트를 통과시키는 것만 구현한다
2. **최소 구현**: 테스트를 통과하는 가장 단순한 코드를 작성한다
3. **의존성 방향 준수**: `packages/ ← modules/ ← services/` 방향만 허용
4. **레이어 규칙 준수**: 각 모듈 README.md 및 루트 CLAUDE.md의 import 규칙을 따른다
5. **클래스 기반 설계**: 도메인 엔티티, VO, 서비스, Port, UseCase, Adapter는 **반드시 클래스로 구현**한다. 순수 유틸리티 함수만 예외.
6. **SOLID 준수**: 단일 책임, 개방-폐쇄(if/elif 체인 대신 다형성), 의존성 역전(Port ABC 경유)

---

## 코드 설계 품질 규칙 (위반 시 리뷰에서 Major)

### 금지 패턴

```python
# ❌ 함수 기반 도메인 설계 — 금지
def process_order(order_data: dict) -> dict:
    if order_data["type"] == "standard": ...
    elif order_data["type"] == "express": ...
    return {"status": "done"}

# ✅ 클래스 기반 도메인 설계 — 필수
class Order(Entity):
    def process(self) -> OrderResult: ...

class OrderProcessingService:
    def execute(self, order: Order) -> OrderResult: ...
```

```python
# ❌ if/elif 체인으로 타입 분기 — OCP 위반
def calculate_price(product_type: str, base: int) -> int:
    if product_type == "book": return base * 0.9
    elif product_type == "electronics": return base * 1.1
    elif product_type == "food": return base * 0.95
    # 새 타입 추가마다 여기를 수정해야 함

# ✅ Strategy 패턴으로 분기 — OCP 준수
class PricingStrategy(ABC):
    @abstractmethod
    def calculate(self, base: int) -> int: ...

class BookPricing(PricingStrategy):
    def calculate(self, base: int) -> int: return int(base * 0.9)
```

### 복잡도 제한

| 규칙 | 기준 |
|------|------|
| 시간 복잡도 | O(N^2) 이상 금지 (N이 사용자/DB 데이터) |
| 중첩 루프 | 3단 이상 금지 |
| 조건문 깊이 | if 3단 이상 중첩 금지 → Early return, Guard clause |
| 메서드 길이 | 50줄 초과 시 분리 |
| 매개변수 수 | 5개 초과 시 VO/DTO로 묶기 |

---

## 구현 파일 위치 — Clean Architecture

```
modules/{module_name}/
├── domain/
│   ├── entities/        ← 도메인 엔티티 (공유 스키마 import만 허용)
│   ├── value_objects/   ← 도메인 VO
│   ├── services/        ← 순수 비즈니스 로직 (프레임워크 import 금지)
│   └── ports/           ← ABC 인터페이스 정의
├── application/
│   └── use_cases/       ← 유스케이스 오케스트레이션 (Port 인터페이스만 참조)
├── adapters/            ← 외부 시스템 연동 (프레임워크 자유 사용)
└── tests/
    ├── unit/domain/
    ├── unit/application/
    └── integration/
```

**프로젝트 루트에 소스 파일 직접 생성 금지.**

---

## 계층별 import 규칙 (절대 위반 금지)

### domain/ 레이어

```python
# ✅ 허용 — 공유 스키마/타입만
from common_schemas import SomeSchema
from common_schemas.enums import RiskLevel

# ❌ 금지 — 프레임워크 import
from fastapi import Depends
from sqlalchemy import Column
from langgraph.graph import StateGraph
from celery import shared_task
```

### application/ 레이어

```python
# ✅ 허용 — Port(ABC) 참조
from <module>.domain.ports import SomeRepository

# ❌ 금지 — 구체 Adapter 직접 import (services/에서만 DI로 조립)
from storage.repositories import SomeRepository
```

### adapters/ 레이어

```python
# ✅ 자유 사용 — 외부 라이브러리 + domain/ports 구현
from <module>.domain.ports import CipherPort
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
```

### services/ 레이어 (Composition Root)

```python
# ✅ 모든 modules/* 조립 가능
from <module>.application.use_cases import SomeUseCase
from storage.repositories import SomeRepository
```

---

## 환경변수 로드 방식

```python
import os

# 실제 값은 기본값 없이 로드
DB_HOST = os.getenv("DB_HOST")
DB_PASSWORD = os.getenv("DB_PASSWORD")

# 공개 표준 포트만 기본값 허용
DB_PORT = int(os.getenv("DB_PORT", "5432"))
```

**절대 금지**: `os.getenv("DB_HOST", "10.0.0.1")` — 기본값에 실제 인프라 정보 금지

---

## DB 접근 코드 작성 원칙 (MANDATORY)

> 쿼리 1회당 네트워크 왕복이 발생한다. 코드 작성 전 DB 왕복 수를 계획하고 주석으로 명시한다.

### 금지 — N+1 쿼리

```python
# ❌ 루프 안에서 fetch
for item_id in item_ids:
    row = await session.execute(select(Model).where(Model.id == item_id))
```

### 올바른 패턴 — 배치 조회

```python
# DB 왕복 계획: SELECT 1회
rows = await session.execute(select(Model).where(Model.id.in_(item_ids)))
items = {m.id: m for m in rows.scalars()}
```

| 총 DB 왕복 수 | 판단 | 조치 |
|--------------|------|------|
| ~50회 이하 | 양호 | 그대로 구현 |
| 50~100회 | 주의 | 배치 통합 검토 |
| 100회 초과 | 재설계 | 루프 안 쿼리 제거 필수 |

---

## ORM ↔ 도메인 모델 변환 원칙

ORM 모델은 도메인 경계를 **절대 넘지 않는다**. Repository 내부에서 Mapper로 변환하고
도메인 엔티티를 반환한다 (ORM 모델 반환 금지).

---

## 비동기 코드 작성 원칙

1. 라우터/서비스는 모두 `async def`로 작성
2. Blocking I/O 라이브러리(`requests`, `psycopg2`)를 async 핸들러에서 직접 호출 금지
   → `httpx.AsyncClient`, `asyncpg`/SQLAlchemy async 사용
3. CPU 바운드 작업은 태스크 큐(워커)로 분리

---

## 타입/스타일 규칙

- 모든 함수 시그니처에 타입 힌트 명시 (`Optional`은 `T | None`)
- ID 필드는 `UUID` 타입 (str 아님)
- Python: Ruff lint (`line-length=120`), Python ≥ 3.12
- JS/TS: 프로젝트 린트 규칙 준수

---

## 구현 완료 후 린트 실행 (필수)

코드 구현 후, 커밋 전에 반드시 린트를 실행한다.

```bash
# Python
ruff check --fix .
ruff check .

# JS/TS (해당되는 경우)
npm run lint --fix .
```

린트 에러가 잔존하면 수동으로 수정한 뒤 다시 실행한다.
린트 통과를 확인하기 전까지 구현 완료로 보고하지 않는다.

---

## 구현 완료 후 자가 점검

### 아키텍처
- [ ] 의존성 방향 규칙 위반 없음 (`domain/` → 프레임워크 import 없음)
- [ ] ORM 모델이 도메인 레이어 밖으로 노출되지 않음

### 설계 품질
- [ ] 도메인/유스케이스가 클래스로 구현됨 (함수 기반 금지)
- [ ] if/elif 3단 이상 체인 없음 (패턴 적용 또는 다형성)
- [ ] O(N^2) 이상 알고리즘 없음 (N이 사용자 데이터인 경우)
- [ ] 메서드 50줄 / 클래스 300줄 초과 없음
- [ ] 매개변수 5개 초과 없음
- [ ] spec에 명시된 디자인 패턴이 코드에 반영됨

### 성능/보안
- [ ] 루프 안에 DB 쿼리 없음 (N+1 없음)
- [ ] 외부 API 호출마다 try-except + 타임아웃 설정
- [ ] 하드코딩된 API 키, IP, 비밀번호 없음

### 코드 품질
- [ ] 모든 함수/메서드에 타입 힌트 명시
- [ ] Lint 통과 (`ruff check` / `npm run lint`)
