# Noluma — Product Requirements Document

- **제품명**: Noluma
- **형태**: Obsidian Community Plugin (Desktop + iOS + Android)
- **작성일**: 2026-07-06
- **상태**: Active (Phase 1 구현 중)
- **GitHub**: https://github.com/dhwang0803-glitch/Noluma

---

## 1. 제품 정의

> **Obsidian vault를 위한 Knowledge Maintenance Engine — 원샷 AI 질의·자동 저장, inbox 자동 정리, vault 유지보수 자동화를 하나의 플러그인으로 제공한다.**

AI 채팅 앱이 아니다. 사용자가 질문하면 vault 맥락을 반영한 답변을 생성하고 즉시 저장하며, inbox에 쌓이는 노트를 자동 분류·태깅·이동하고, vault 전체의 건강 상태를 유지·관리하는 "정리 엔진"이다.

---

## 2. 핵심 원칙

1. **Maintenance Engine, not Chat App** — 대화형 UI를 최소화하고, 원샷 파이프라인과 자동화에 집중
2. **Hybrid AI** — 규칙 기반(오프라인) + AI API(온디맨드). 사용자가 비용을 통제
3. **Never modify without consent** — 사용자 동의 또는 dry-run 없이 노트 수정 금지
4. **Change history for everything** — 모든 자동 수정에 대해 변경 이력(undo log) 유지
5. **Offline-first** — 네트워크 없이도 기본 정리(규칙 기반 분류, 태깅)가 동작
6. **Cost transparency** — API 호출 비용을 사전 추정하고 사용량 대시보드 제공

---

## 3. 타겟 사용자

| 티어 | 프로필 | 핵심 니즈 |
|------|--------|----------|
| **Tier 1** | Obsidian + AI 파워 유저 (개발자, 연구자, 투자자) | "캡처하면 알아서 정리되었으면" |
| **Tier 2** | 모바일 캡처 중심 지식 노동자 | "inbox를 자동으로 정리해줬으면" |
| **Tier 3** | PKM 방법론 실천자 (PARA/Zettelkasten) | "내 분류 규칙을 자동 적용" |

---

## 4. 비목표

| 의도적으로 다루지 않는 것 | 이유 |
|--------------------------|------|
| 대화형 AI 채팅 UI | Copilot과 직접 경쟁 회피 |
| 온디바이스 LLM | 복잡도/성능 문제 |
| 전체 노트 실시간 모니터링 | 성능 부하. inbox + 이벤트 기반으로 제한 |
| 멀티 디바이스 동기화 | Obsidian Sync에 위임 |
| 임베딩 기반 시맨틱 검색 | Phase 2 이후 선택사항 |
| 자체 클라우드 백엔드 | 로컬 + 직접 API 호출만 |
| 노트 작성 AI 어시스턴트 | "작성"이 아닌 "정리" 도구 |

---

## 5. Phase 로드맵

### Phase 1: Plugin MVP (4~6주)

**목표**: "질문 → 검색 → 응답 → 저장" 파이프라인 증명 + inbox 이벤트 감지

| 기능 | 설명 |
|------|------|
| **Quick Ask & Save** | 모달 질문 → vault BM25 검색 → AI 응답 → 자동 저장 (3 모드) |
| **Vault 키워드 검색** | TF-IDF/BM25 기반, 상위 5개 관련 청크 추출 |
| **AI API 호출** | OpenAI + Gemini, `requestUrl()` 사용, Strategy 패턴 |
| **자동 태깅** | 규칙 기반 (키워드 추출 + 기존 태그 재사용) |
| **Inbox Watcher** | vault.on 이벤트 감지, 3초 디바운싱, 알림 표시 |
| **기본 설정 UI** | AI 공급자, API 키, inbox 폴더, 저장 기본값 |
| **모바일 호환성** | requestUrl(), 반응형 모달 UI |

**검증 기준**:
- Quick Ask 모달에서 AI 응답이 표시되고 노트로 저장됨
- Inbox 폴더에 노트 추가 시 이벤트 감지 + 알림
- Desktop/iOS/Android 동작 확인

### Phase 2: Organizer MVP (6~8주)

**목표**: "inbox가 자동으로 정리된다"

| 기능 | 설명 |
|------|------|
| **AI 기반 분류** | 폴더 제안, 태그 제안, 백링크 제안 |
| **Dry-run 모드** | 변경 미리보기 → 사용자 승인 → 실행 |
| **변경 이력** | 모든 자동 수정 기록, 되돌리기 지원 |
| **클립보드 캡처** | 클립보드 → inbox 노트 저장 |
| **데일리 노트 스캔** | 미처리 텍스트 블록 식별 + 분리 제안 |
| **Vault Maintenance** | 고아 노트, 중복 노트, 깨진 링크 탐지 |
| **API 비용 대시보드** | 토큰 사용량 추적, 월별 한도 설정 |
| **사용자 정의 규칙** | 커스텀 분류 규칙, 프라이버시 규칙 UI |

### Phase 3: Android Companion (선택, 4~6주)

- Android PROCESS_TEXT intent handler
- 텍스트 선택 → vault inbox에 .md 생성
- 플러그인이 파일 기반으로 감지

---

## 6. 핵심 사용자 시나리오

### S1: Quick Ask & Save

1. Command Palette → "Quick Ask" 실행
2. 질문 입력 → vault에서 관련 노트 검색 (BM25)
3. vault 컨텍스트 + 질문 → AI API 호출
4. 응답 모달 표시 → 저장 옵션 선택 (새 노트 / 기존 노트 append / 데일리 노트)
5. 자동 태깅 + 백링크 추가 후 저장

**성공 기준**: 질문 입력 → 저장 완료 30초 이내

### S2: Inbox 자동 정리

1. inbox 폴더에 노트 추가 → 플러그인 감지
2. 사이드바 "정리 대기: N개" 알림
3. 사용자 "정리 미리보기" 클릭 (dry-run)
4. 각 노트별 폴더/태그/링크 제안 표시
5. 사용자 검토 → 수정 → "적용" 클릭
6. 변경 이력 기록

**성공 기준**: 15개 노트 분류 제안 5초 이내, 사용자 수정 비율 20% 이하

### S3: Vault Maintenance

1. "Vault Maintenance" 실행
2. 분석 결과: 고아 노트, 중복 의심, 미태깅, 깨진 링크
3. 각 항목 → 제안 액션 (백링크 추가, 병합, 태깅)
4. 모든 변경에 이력 기록

**성공 기준**: 2,000개 vault 분석 30초 이내

---

## 7. 기능 요구사항

### F1: Quick Ask & Save

- **모달 UI**: 질문 입력, vault 검색 포함 옵션, 응답 마크다운 렌더링, 저장 옵션
- **검색**: 질문 키워드 추출 → BM25 기반 vault 검색 → 상위 k개 청크
- **AI 호출**: requestUrl() 전용, OpenAI/Gemini Strategy 패턴, 30초 타임아웃
- **저장**: 새 노트 / 기존 노트 append / 데일리 노트. frontmatter 자동 생성
- **자동 메타데이터**: date, source: quick-ask, tags (키워드 기반), 원본 질문 인용

### F2: Inbox Watcher

- **이벤트 감시**: vault.on('create'), vault.on('modify') — inbox 폴더만
- **디바운싱**: 3초 (연속 이벤트 병합, 편집 중 방해 금지)
- **Catch-up**: 앱 시작 시 미처리 노트 목록 확인
- **Phase 2 확장**: 규칙 기반 + AI 기반 자동 분류

### F3: 클립보드 캡처 (Phase 2)

- `navigator.clipboard.readText()` → inbox 노트 저장
- 자동 제목 생성 (첫 줄 또는 타임스탬프)
- 메타데이터: source: clipboard, captured_at: timestamp

### F4: Vault Maintenance (Phase 2)

- **고아 노트**: 백링크 없는 노트 탐지 + 관련 노트 후보 제안
- **중복 노트**: 제목 유사도 (Levenshtein) + 내용 해시 비교
- **깨진 링크**: wikilink 대상 파일 존재 확인
- **미태깅 노트**: frontmatter tags 비어있는 노트 목록

### F5: 변경 이력 (Phase 2)

- 모든 자동 수정에 대해: 변경 유형, 변경 전/후 상태, 타임스탬프
- 되돌리기 (undo) 지원: 개별 또는 배치 단위
- 저장: `.knowledge-maintenance/history/YYYY-MM.json` (월별 분할)

### F6: 설정 UI

| 설정 그룹 | 항목 |
|-----------|------|
| AI 공급자 | 제공자 선택, API 키, 모델, 토큰 제한 |
| Inbox | 감시 폴더, 자동 적용 여부 |
| 저장 | 기본 폴더, 데일리 노트 형식 |
| 유지보수 | 자동 실행 토글, 실행 주기 |
| 프라이버시 | 제외 폴더/태그/frontmatter 규칙 |
| 비용 | 월별 한도 (Phase 2) |

---

## 8. 비기능 요구사항

### 성능

| 항목 | 목표 |
|------|------|
| 플러그인 로딩 | 1초 이내 |
| Quick Ask (AI 제외) | 3초 이내 |
| Inbox 이벤트 감지 | 디바운스 후 3초 |
| Vault 분석 (2,000 노트) | 30초 이내 |
| 메모리 (idle) | 50MB 이하 |

### 안정성

| 항목 | 목표 |
|------|------|
| 데이터 손실 | 0건 |
| API 실패 | 재시도 + 명확한 에러 메시지 |
| 앱 종료 복구 | 변경 이력에서 복구 가능 |

### 보안

- API 키: Obsidian data.json 표준 방식 저장, UI 마스킹
- API 호출: HTTPS, 직접 호출 (중간 서버 없음)
- vault 데이터: 사용자 명시적 요청 시에만 AI에 전송
- 프라이버시 규칙: 지정 폴더/태그 노트는 AI 전송에서 제외

---

## 9. Obsidian 기술 제약

| 제약 | 대응 |
|------|------|
| 모바일 HTTP | `requestUrl()` 전용 (fetch/request 사용 금지) |
| Node.js API 미사용 | Obsidian Vault API 전용 |
| 싱글 스레드 | 작업 분할 (chunking), 배치 처리 |
| data.json 크기 | 이력은 별도 JSON, 인덱스 캐싱 |
| 백그라운드 제한 (모바일) | 포그라운드 작업 위주, 앱 재개 시 catch-up |
| HTTP 메서드 | 대문자 필수 ("POST", "GET") |
| 헤더 | Content-Type, Authorization 항상 명시 |

---

## 10. 현재 구현 상태 (2026-07-06)

### 완료

- Clean Architecture 전체 골격 (Domain, Application, Adapters, UI, Composition Root)
- 7개 Port 인터페이스, 7개 Value Object, 8개 Domain Model 정의
- AI 어댑터 구현 (OpenAI, Gemini) — requestUrl() 기반, 에러 핸들링 포함
- 검색 인덱스 어댑터 (JSON 기반 BM25 검색)
- 변경 이력 어댑터 (월별 JSON 파일)
- UI 골격 (QuickAskModal, MaintenanceLogView, InboxStatusView, PluginSettingTab)
- 7개 Obsidian 명령 등록
- 플러그인 설정 로드/저장

### Phase 1 구현 대상 (스텁 10건)

| UseCase/Adapter | 스텁 메서드 |
|-----------------|------------|
| QuickAskUseCase | buildPrompt, isChunkAllowed, extractLinkSuggestions, formatAnswer |
| SaveNoteUseCase | insertUnderHeading, resolveDailyNotePath, formatDate |
| ObsidianVaultAdapter | parseMetadata, splitIntoChunks |
| main.ts | startInboxWatcher |

### 구현 전 선행 작업 (코드 품질)

- ConfigPort 인라인 중복 제거
- constants.ts SSOT화
- HistoryFilter 중복 정의 제거
- AI 어댑터 인라인 프롬프트 UseCase로 이전
- SaveTarget as any 캐스팅 제거

> 상세: `docs/specs/spec-delta-register.md` 참조

---

## 11. 경쟁 포지셔닝

| 경쟁 제품 | 강점 | Noluma 차별점 |
|----------|------|-------------|
| Obsidian Copilot (330k+ DL) | AI 채팅, vault QA | Copilot이 안 하는 "정리/유지보수" 자동화 |
| Smart Connections | 시맨틱 검색, 관련 노트 제안 | 검색을 넘어선 자동 분류/이동/태깅 파이프라인 |
| Auto Note Mover | 규칙 기반 파일 이동 | AI 기반 분류 + dry-run + 이력 관리 |

**포지셔닝**: "AI가 대화만 하는 게 아니라, 지식을 정리해준다"

---

## 갱신 이력

| 날짜 | 내용 |
|------|------|
| 2026-07-06 | 초기 작성 — Codex PRD를 현재 코드/결정에 맞춰 적응 |
