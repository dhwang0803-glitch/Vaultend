# 기술 부채 레지스터

> 처리해야 할 기술 부채와 기한이 있는 유지보수 항목을 추적한다. (`docs` 브랜치에서만 편집)
> 항목을 처리하면 상태를 `Done (PR #NN)`으로 바꾸고 삭제하지 않는다 — 이력이 곧 근거다.
> 사용자 경험 버그(오류 표시·태그 표기 등)는 별도 spec `docs/specs/ux-feedback-integrity.md`에서 다룬다 (`feature/ux-feedback-integrity` 브랜치 — 구현 PR과 함께 병합 예정).

- **최초 작성**: 2026-11-13 (v1.0.23 준비 중 외부 인프라 점검·실기기 테스트에서 도출, 관련 PR #267)
- **검증 방식 표기**: `실측` = 실제 API/Obsidian 앱에서 확인, `코드` = 코드 경로 분석으로 확인(재현 미실시)

## 요약

| # | 항목 | 우선순위 | 상태 |
|---|------|---------|------|
| TD-1 | 단위 테스트의 `requestUrl` mock이 실제 Obsidian과 다름 → Rate Limit Circuit Breaker 미작동 | **High** | Open |
| TD-2 | API 키 `data.json` 평문 저장 | Medium | Open |
| TD-3 | Gemini API 키가 URL 쿼리 파라미터로 전송 | Medium | Open |
| TD-4 | 잔재 정리 (`versions.json` "undefined", 미사용 패키지 3개, 미사용 `aiTemperature`) | Low | Open |
| TD-5 | `e2e/` 스크립트 노후화 — 실기기 회귀 테스트 도구 정식화 | Medium | Open |
| DL-1 | 기본 모델 `gpt-4o` 종료 (2027-01-14) | **High (기한)** | Open |
| DL-2 | `gemini-2.5-pro` 종료 (2026-12-01) 후 목록 제거 | High (기한) | Open |
| DL-3 | Gemini 신규 모델 미반영 + `gemini-3.5-flash` 가격 불일치 | Medium | Open |

---

## TD-1. `requestUrl` mock과 실제 동작 불일치 → Circuit Breaker 미작동 (High)

**현상** (`실측` 2026-11-13, Obsidian 앱 CDP 프로브)
- 실제 Obsidian `requestUrl`은 기본값(`throw: true`)에서 4xx/5xx 시 **예외를 던진다**.
  예외 객체: `message: "Request failed, status 401"`, 고유 속성 `status`(숫자), `headers`. **응답 본문은 없다.**
- 단위 테스트 mock(`src/test-utils/__mocks__/obsidian.ts` 사용 테스트들)은 4xx에서 `{ status: 429, json: … }`를 **정상 반환**한다고 가정한다.

**영향** (`코드`, 4개 AI 어댑터 공통 `requestWithRetry`)
- `if (response.status === 429)` / `=== 503` 분기는 **실제 앱에서 도달하지 않는다**.
- 429는 `catch`로 들어가 `isRetryableMessage`(메시지에 "429" 포함)로 **백오프 재시도 3회** 후 `AIProviderError(…, 0, '3회 재시도 후 실패')`가 된다.
  → ADR-0008의 **Rate Limit Circuit Breaker(`RateLimitError` 즉시 throw + `rateLimitedUntil`)가 실제로는 작동하지 않는다.** 테스트(`429 응답 시 즉시 RateLimitError를 던진다`)는 mock 가정 때문에 통과한다.
- 모든 오류의 `statusCode`가 0으로 기록되어 사용자 메시지에서 원인(키 오류/모델 종료 등)을 구분할 수 없다 (UX spec 항목 UX-2와 연결).
- Gemini thinkingConfig 폴백(v1.0.23)은 이 차이를 인지하고 `statusCode 0 + "status 400"` 메시지로 판별하도록 구현됨.

**처리 방향**
1. mock을 실제 동작과 일치시킨다: 4xx/5xx에서 `status`·`headers` 속성을 가진 Error를 throw (본문 없음).
2. 어댑터는 예외의 `status` 속성을 읽어 `AIProviderError.statusCode`를 채운다 — 429 분기를 catch 경로에서 처리하도록 정리.
3. 429 실제 재현 테스트(실기기)로 circuit breaker 동작 확인. 4개 어댑터 중복 로직은 공통 헬퍼로 추출 검토.

---

## TD-2. API 키 평문 저장 (Medium)

**현상**: `aiApiKey`·`customApiKey`가 `.obsidian/plugins/vaultend/data.json`에 평문 저장. vault를 동기화(Obsidian Sync·Git·클라우드)하면 키가 함께 퍼진다.

**처리 방향**
- Obsidian 1.11.4+의 `app.secretStorage`(`getSecret`/`setSecret`) + 설정 UI `SecretComponent` 사용. 설정에는 secret **이름**만 저장.
- 제약: `minAppVersion`을 1.7.2 → 1.11.4 이상으로 올려야 함 (또는 하위 버전 폴백 유지).
- 기존 평문 키의 1회 이관(migration)과 이관 후 `data.json`에서 제거 필요.
- 확인 필요: 포럼 보고상 SecretStorage가 데스크톱은 vault 단위, 모바일은 vault 간 공유로 동작이 다를 수 있음 (공식 확인 안 됨).

---

## TD-3. Gemini API 키 URL 노출 (Medium)

**현상**: `GeminiAdapter`가 `generateContent`·`batchEmbedContents` 호출 시 `?key=${apiKey}`를 URL에 붙인다. URL은 프록시·로그·오류 메시지에 남기 쉽다.

**처리 방향**: `x-goog-api-key` 헤더로 이동 (2026-11-13 실측: 헤더 방식으로 generateContent·batchEmbedContents 모두 정상 동작). 기존 테스트 `URL에 API 키를 쿼리 파라미터로 포함한다`는 헤더 검증으로 교체.

---

## TD-4. 잔재 정리 (Low)

| 대상 | 위치 | 근거 |
|------|------|------|
| `"undefined": "1.7.2"` 항목 | `versions.json` | 과거 `version-bump` 실행 시 버전 미전달로 생성된 것으로 추정 |
| `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` | `package.json` | `src`에서 import 없음 (모든 호출은 `requestUrl` 직접 사용). `@google/generative-ai`는 Google이 지원 종료한 SDK. esbuild 번들에는 포함되지 않으므로 사용자 영향 없음 |
| `aiTemperature` 필드·`DEFAULT_AI_TEMPERATURE` | `ConfigPort`, `main.ts`, `constants.ts` | UI·코드 어디서도 읽지 않음. Quick Ask 분리(0.8.0) 잔재. 저장된 `data.json` 값은 무해 |

> 주의: `aiMaxTokens`는 잔재가 아니다 — v1.0.23(PR #267)에서 작업별 출력 상한으로 재연결됨.

---

## TD-5. e2e 스크립트 노후화 → 실기기 회귀 테스트 정식화 (Medium)

**현상**: `e2e/test-obsidian-ui.mjs`와 스크린샷은 Quick Ask 기준(0.8.0 이전)이라 현재 기능을 검증하지 못한다.

**v1.0.23 준비 중 사용한 도구** (저장소 미포함, 작업자 로컬)
- `setup.py`: 테스트 vault 백업본에서 클린 복원 → 빌드 설치(설치본 manifest만 버전 변경) → 시나리오별 `data.json` 주입(키는 환경변수에서)
- `driver.mjs`: `--remote-debugging-port`로 Obsidian 실행 → `playwright-core` CDP 연결 → 플러그인 로드·What's New·설정 UI·노트/폴더/태그 정리·임베딩 상태·Notice·콘솔 오류 수집
- 같은 시나리오를 **직전 릴리즈 빌드와 새 빌드로 나란히 실행해 결과 비교** (회귀 판정)

**처리 방향**
- `e2e/`를 위 구조로 교체하고 `/release` Step 3(로컬 확인)에 자동 실행 옵션으로 연결.
- 필수 안전장치: API 키는 환경변수로만 주입, 실행 후 vault 복원 + 키 잔존 검사, 개인 vault 접근 금지(테스트 vault 경로 고정), `playwright-core`는 devDependency.
- 실행 전 열린 Obsidian을 종료해야 함(단일 인스턴스) — 자동 실행 시 사용자 확인 필요.

---

## 기한 있는 항목 (Deadline)

### DL-1. 기본 모델 `gpt-4o` 종료 — 2027-01-14 (High)
- OpenAI가 `gpt-4o`(2024-08-06·11-20 스냅샷), `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`를 2027-01-14 종료 예정. 권장 대체: `gpt-6-luna`.
- `DEFAULT_AI_MODEL = 'gpt-4o'` (`src/constants.ts`) — 신규 설치 기본값이자 기존 사용자 대다수의 저장값.
- 처리: (1) 기본값 변경, (2) 종료일 전 What's New 사전 안내, (3) 종료 후 `RetiredModelMigration`에 매핑 추가 + 드롭다운 제거.

### DL-2. `gemini-2.5-pro` 종료 — 2026-12-01 (High)
- v1.0.23 What's New에서 "종료 후 목록에서 제거 예정" 안내함. 신규 사용자는 이미 사용 불가(404).
- 처리: 12/1 이후 드롭다운 제거 + `RetiredModelMigration`에 대체 매핑 추가(Google 권장 대체: `gemini-3.8-flash`). 같은 날 `gemini-2.5-flash`는 `gemini-3.5-flash-lite`로 자동 라우팅·과금됨 — 가격표 영향 확인.

### DL-3. Gemini 모델 목록·가격 (Medium)
- 드롭다운에 없음: `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`.
- `gemini-3.5-flash`는 3.6으로 자동 라우팅되어 3.6 요금($0.75/$3.75, 2027-01-01부터 $1.50/$7.50)으로 과금되나 가격표는 $1.50/$9.00 → 비용 과대 표시.
- 가격이 날짜에 따라 바뀌는 모델이 있어 정적 가격표 구조의 한계 검토 필요.
- 신규 모델 추가 시 `GeminiGenerationPolicy`의 thinking 규칙 적용 여부를 실측으로 확인할 것 (v1.0.23 매트릭스 검증 절차 참고).
