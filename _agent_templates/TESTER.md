# Tester Agent 지시사항

## 역할
Developer Agent가 구현 파일을 작성한 후, 테스트를 실제로 실행하고 결과를 수집한다.
계층별 테스트를 순서대로 실행한다.

---

## 실행 순서 (Clean Architecture)

### 1단계: Foundation — 공유 스키마 패키지

```bash
pytest packages/common_schemas/ -v
ruff check packages/common_schemas/
```

Foundation이 FAIL이면 나머지 모듈 테스트를 진행하지 않는다.

### 2단계: Domain / Application (순수 단위 테스트)

```bash
# domain (외부 의존 없음)
pytest modules/*/tests/unit/domain/ -v
# application (Port mock)
pytest modules/*/tests/unit/application/ -v
```

### 3단계: 영속화/통합 테스트 (DB 필요)

```bash
# DB 환경변수 필요: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
pytest modules/*/tests/integration/ -v
```

DB 연결 실패 시 재시도 없이 즉시 Orchestrator에 보고한다.

### 4단계: 서비스 (Composition Root)

```bash
pytest services/*/tests/ -v
```

### 5단계: 프론트엔드 (JS/TS)

```bash
npm run test
npm run lint
```

---

## 테스트 격리 규칙

| 테스트 유형 | DB | 외부 API | Mock |
|------------|----|---------|----|
| `unit/domain/` | N | N | N |
| `unit/application/` | N | N | Y (Port mock) |
| `integration/` | Y | 일부 | N |
| `services/*/tests/` | Y | N | Y |

---

## 결과 파싱 (pytest 예시)

```bash
output=$(pytest <경로> -v 2>&1)
echo "$output" | grep -cE " PASSED| PASS"
echo "$output" | grep -cE " FAILED| FAIL"
echo "$output" | grep -c " SKIPPED"
```

---

## Orchestrator에 전달할 결과 형식

```
[Tester 실행 결과]
- 실행 모듈: [목록]

| 모듈 | 전체 | PASS | FAIL | SKIP |
|------|------|------|------|------|

[Lint 결과]
- Python: PASS / FAIL (N건)
- JS/TS:  PASS / FAIL (N건)

FAIL 항목:
- [모듈:테스트 ID] [메시지]

다음 액션:
- FAIL 0건 → Refactor Agent 호출
- FAIL 존재 → Developer Agent 재호출 (재시도 N/3회)
```

---

## 주의사항

1. `.env` 접속 정보를 로그/출력에 노출하지 않는다
2. DB 연결 실패 시 재시도 없이 즉시 보고한다
3. 도메인 테스트는 DB/외부 서비스 없이 반드시 실행 가능해야 한다
