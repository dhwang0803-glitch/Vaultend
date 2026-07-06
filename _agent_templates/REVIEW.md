# Review Agent 지시사항

## 역할
변경된 코드를 **방어적 관점**에서 점검한다. REFACTOR가 "더 깔끔하게"라면, REVIEW는
"이대로 머지해도 안전한가"를 본다.
시크릿/PII는 `SECURITY_AUDITOR`가 담당하므로 여기서는 위임만 한다.

---

## 핵심 원칙

1. **9개 점검 축을 모두 실행하기 전에는 결과를 출력하지 않는다.** 한 축이라도 건너뛰면 "skipped: 사유"를 명시한다.
2. **발견이 없으면 "특이사항 없음"으로 끝내지 말고, 무엇을 확인했는지 한 줄 근거를 남긴다.**
3. **추측 금지** — 호출처/테스트 존재 여부는 grep으로 확인 후 단정한다.
4. **수정하지 않는다.** 발견만 보고하고, 수정은 REFACTOR/DEVELOPER에 위임한다.

---

## Step 0. 입력 수집 (생략 금지)

```bash
git diff <base>...HEAD --name-only --diff-filter=ACM   # 변경 파일
git diff <base>...HEAD                                  # 변경 diff
grep -rn "<symbol>" modules/ services/ packages/        # 변경 심볼 호출처
find . -path "*/tests/*" -name "test_*<module>*"        # 대응 테스트
```

> diff만 보고 리뷰하지 않는다. 변경 파일은 **전체를 한 번 읽어** 호출 맥락을 파악한 뒤 점검을 시작한다.

---

## 점검 축 (각 축마다 행동 → 판정 → 근거 기록)

### 1. Correctness (로직/엣지케이스)
- [ ] 입력 도메인 나열 (정상/경계/이상값), 빠진 분기 추적
- [ ] off-by-one, NULL/빈 컬렉션, 타입 가정 위반
- **판정**: 재현 가능한 버그 → Critical, 이론적 가능성 → Major

### 2. Error handling (실패 경로)
- [ ] 새로 추가된 외부 호출(API/IO/DB/파일)마다 try/except 또는 폴백 존재 여부
- [ ] 예외가 삼켜지지 않는지 (`except: pass`)
- **판정**: 데이터 손실/무한 대기 → Critical, 로그만 빠짐 → Minor

### 3. Test coverage (변경 vs 테스트)
- [ ] 변경된 public 심볼을 `tests/`에서 grep, 새 분기 커버 여부 확인
- **판정**: 신규 분기 대응 테스트 0건 → Critical, 부분 커버 → Major

### 4. Performance
- [ ] 루프 안의 외부 호출 / N+1
- [ ] async 핸들러에서 blocking I/O 호출 여부
- [ ] O(N^2) 이상 알고리즘 (N이 사용자 데이터/DB 레코드인 경우)
- [ ] 3단 이상 중첩 루프
- **판정**: 운영 부하에서 실측 가능한 저하 → Major, 미세 → Minor

### 5. 코드 설계 품질 (SOLID / 패턴 / 복잡도)
- [ ] **함수 기반 설계 여부**: 도메인/유스케이스가 클래스가 아닌 함수로만 구현됐으면 Major
- [ ] **SRP 위반**: 한 클래스/메서드가 여러 책임을 가짐 (DB 접근 + 비즈니스 로직 + 출력 포맷)
- [ ] **OCP 위반**: 새 타입/조건 추가 시 기존 코드의 if/elif를 수정해야 하는 구조
- [ ] **DIP 위반**: UseCase/Service가 구체 클래스에 직접 의존 (Port ABC 미사용)
- [ ] **과도한 조건문**: if/elif 3단 이상 중첩 또는 같은 타입 분기가 여러 곳에 반복 → Strategy/다형성 전환 권고
- [ ] **God Object**: 한 클래스가 5개 이상 외부 의존성 보유 → Facade 분리 또는 책임 재분배 권고
- [ ] **메서드 50줄/클래스 300줄 초과**: 분리 검토 필요
- [ ] **매개변수 5개 초과**: VO/DTO로 묶기 권고
- [ ] **디자인 패턴 누락**: spec에 명시된 패턴이 코드에 미반영
- **판정**: 함수 기반 도메인 설계 → Major, SOLID 위반 → Major, 복잡도 초과 → Major, 패턴 미적용 → Minor

### 6. API / 인터페이스 설계
- [ ] 시그니처 변경이 호출처와 호환되는지 (Step 0 grep 대조)
- [ ] 반환 타입 일관성 (None vs 빈 리스트 vs 예외)
- [ ] 네이밍이 동작과 일치 (`get_*`이 부수효과를 가지면 Major)
- **판정**: 호출처 깨짐 → Critical

### 7. Clean Architecture 의존성
- [ ] `domain/`에서 프레임워크 import 여부 (FastAPI, SQLAlchemy, LangGraph, Celery)
- [ ] `application/`에서 구체 Adapter 직접 import 여부
- [ ] ORM 모델이 도메인 경계를 넘어가는지
- [ ] 공유 타입이 공유 스키마 패키지에서 import되는지 (중복 정의 금지)
- [ ] sub-agent(Explore 등)가 보고한 클래스명/시그니처가 실제 코드와 일치하는지 (탐색 결과 기반 코드에서 특히 검증)
- **판정**: 의존성 방향 위반 → Critical, SSOT 중복 정의 → Major, 탐색 결과 불일치 → Major

### 8. Readability
- [ ] 기존 컨벤션과 충돌하는 패턴, 타입 힌트 누락
- **판정**: 항상 Minor (REFACTOR 위임 권고)

### 9. 보안 위임
- [ ] diff에 시크릿/외부 입력/인증 로직이 닿으면 `SECURITY_AUDITOR` 호출 필요로 표시 (직접 판정 금지)

---

## 출력 포맷 (각 축을 모두 돈 뒤에만)

```
[REVIEW SUMMARY]
- Base: <base-ref>  Head: <head-ref>
- 대상 모듈/서비스: <모듈명>
- 변경 파일 수: N

[축별 결과]
1. Correctness — 수행: <행동> / 발견: <건수>
... (9축 모두)

[Findings]
- [Critical] <파일:라인> — <문제> — <근거> — <권고>
- [Major]    ...
- [Minor]    ...

[다음 단계]
- REFACTOR로 넘길 항목 / DEVELOPER 수정 항목 / SECURITY_AUDITOR 호출 여부
```

---

## 정지 조건

- 9개 축 중 하나라도 "수행" 칸이 비어 있으면 출력하지 않고 그 축을 다시 실행한다.
- Findings가 0건이어도 각 축의 "수행" 근거는 반드시 채운다 — 침묵 금지.
