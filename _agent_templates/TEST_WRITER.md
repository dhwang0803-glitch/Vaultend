# Test Writer Agent 지시사항

## 역할

구현 전에 실패하는 테스트를 먼저 작성한다 (TDD Red 단계).

---

## 테스트 작성 원칙

1. 구현 코드가 없어도 테스트를 먼저 작성한다
2. 각 테스트는 하나의 요구사항만 검증한다
3. 기대값을 명확하게 명시한다
4. 테스트 실패 시 원인을 파악할 수 있는 메시지를 포함한다
5. 외부 API/네트워크 의존 테스트는 실제 호출과 Mock 모드를 구분한다

---

## 테스트 계층별 가이드 (Clean Architecture)

### domain/ 테스트 — 순수 단위 테스트

Mock 불필요. 외부 의존성 없이 순수 비즈니스 로직만 검증.

```python
# modules/<module>/tests/unit/domain/test_<service>.py
from <module>.domain.services import SomeResolver

def test_admin_gets_highest_ceiling():
    resolver = SomeResolver()
    result = resolver.resolve(role="admin")
    assert result.ceiling == "CRITICAL"
```

### application/ 테스트 — Port Mock으로 유스케이스 검증

```python
# modules/<module>/tests/unit/application/test_<use_case>.py
import pytest
from unittest.mock import AsyncMock
from <module>.application.use_cases import SomeUseCase

@pytest.mark.asyncio
async def test_use_case_persists_result():
    repo = AsyncMock()
    use_case = SomeUseCase(repo=repo)
    await use_case.execute(payload="x")
    repo.save.assert_called_once()
```

### integration/ 테스트 — 실제 외부 시스템 연동

```python
# modules/<module>/tests/integration/test_<adapter>.py
import pytest

@pytest.mark.asyncio
async def test_save_and_retrieve(repo):
    saved = await repo.save(entity)
    loaded = await repo.get(saved.id)
    assert loaded.name == entity.name
```

### 서버/라우터 테스트 (Python 백엔드)

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import create_app

@pytest.mark.asyncio
async def test_endpoint_rejects_invalid():
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/things", json={"bad": True})
    assert r.status_code == 400
```

### 프론트엔드 테스트 (JS/TS)

```typescript
// tests/component.test.tsx
import { render, screen } from "@testing-library/react";
import { Canvas } from "@/components/canvas";

test("renders empty canvas", () => {
  render(<Canvas items={[]} />);
  expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
});
```

---

## 테스트 격리 규칙

| 테스트 유형 | DB 필요 | 외부 API | Mock |
|------------|--------|---------|------|
| `unit/domain/` | N | N | N (순수 로직) |
| `unit/application/` | N | N | Y (Port mock) |
| `integration/` | Y | 일부 | N (실제 연동) |
| `services/*/tests/` | Y | N | Y (modules mock 가능) |

---

## 테스트 결과 수집 형식

```
전체 테스트: X건
PASS: X건 / FAIL: X건 / SKIP: X건

FAIL 목록:
- [테스트 ID]: [실패 메시지]
```

---

## 실행 명령 (참고)

- Python: `pytest`
- JS/TS: `npm run test`
