# Knowledge Maintenance — Obsidian Plugin

AI를 활용하여 Obsidian Vault를 자동으로 분류, 태깅, 연결, 유지보수하는 플러그인입니다.

노트를 쓰는 데 집중하세요. 정리는 AI가 합니다.

---

## 핵심 기능

### Quick Ask

Command Palette에서 `Quick Ask`을 실행하면 Vault의 기존 노트를 컨텍스트로 활용하여 AI에게 질문할 수 있습니다.

- Vault 내 관련 노트를 자동으로 검색하여 AI 프롬프트에 포함
- 답변을 새 노트 또는 Daily Note에 자동 저장
- 응답에서 `[[wikilink]]`를 추출하여 링크 제안
- 토큰 사용량과 비용을 실시간으로 표시

### 노트 자동 정리

`현재 노트 정리` 명령으로 열려 있는 노트를 AI가 분석합니다.

- 카테고리 분류 (technology, personal, work 등)
- 태그 자동 제안 및 추가
- Vault 내 다른 노트와의 연결 링크 제안
- 폴더 이동 제안 (분류 기반)

### Inbox 자동 처리

지정된 Inbox 폴더에 새 노트가 들어오면 자동으로 감지하고 처리합니다.

- 파일 생성/수정 이벤트 실시간 감시 (2초 디바운싱)
- `Inbox 처리` 명령으로 수동 실행도 가능
- 앱 시작 시 미처리 노트를 자동으로 catch-up

### Vault 유지보수

`유지보수 실행` 명령으로 Vault 전체를 스캔합니다.

- **고아 노트 탐지**: 어디에서도 링크되지 않은 노트
- **중복 후보 감지**: Jaccard 유사도 기반 유사 노트 쌍
- **깨진 링크 발견**: 존재하지 않는 노트를 가리키는 `[[wikilink]]`
- **태그 제안**: 콘텐츠 기반으로 누락된 태그 추천
- 자동 스케줄링 (설정한 주기마다 백그라운드 실행)

### 프라이버시 보호

AI에게 전송되는 내용을 세밀하게 제어합니다.

| 규칙 타입 | 동작 |
|-----------|------|
| 폴더 제외 | 지정 폴더의 노트를 AI 컨텍스트에서 완전히 제외 |
| 태그 제외 | 특정 태그가 달린 노트를 제외 |
| Frontmatter 제외 | 특정 frontmatter 키가 있는 노트를 제외 |
| 내용 마스킹 | 정규식 패턴에 매칭되는 텍스트를 `[REDACTED]`로 치환 후 전송 |

**내용 마스킹 예시**: 패턴 `password:\S+`를 설정하면 노트 안의 `password:abc123`이 `[REDACTED]`로 바뀌어 AI에게 전송됩니다. 원본 노트는 변경되지 않습니다.

### 클립보드 캡처

클립보드의 텍스트를 바로 노트로 저장합니다.

### 이력 관리

모든 작업(분류, 정리, Quick Ask 저장 등)의 이력을 기록하고, `유지보수 로그 열기` 명령으로 사이드 패널에서 확인할 수 있습니다.

---

## 명령어 목록

| 명령어 | 설명 |
|--------|------|
| Quick Ask | AI에게 질문 (Vault 컨텍스트 활용) |
| 현재 노트 정리 | 열린 노트를 AI로 분류·태깅 |
| Inbox 처리 | Inbox 폴더의 노트를 일괄 처리 |
| 유지보수 실행 | Vault 전체 스캔 (고아·중복·깨진 링크) |
| 클립보드 캡처 | 클립보드 내용을 노트로 저장 |
| 유지보수 로그 열기 | 작업 이력 사이드 패널 표시 |
| Inbox 상태 열기 | Inbox 폴더 현황 사이드 패널 표시 |

---

## 설정

### AI 공급자

| 항목 | 설명 | 기본값 |
|------|------|--------|
| AI 공급자 | OpenAI 또는 Google Gemini | OpenAI |
| API 키 | 선택한 공급자의 API 키 | — |
| 모델 | 사용할 모델명 | gpt-4o |
| Max Tokens | AI 응답 최대 토큰 수 | 2048 |
| Temperature | 응답 창의성 (0.0~1.0) | 0.3 |

### Inbox

| 항목 | 설명 | 기본값 |
|------|------|--------|
| Inbox 폴더 | 미처리 노트가 수집되는 폴더 | Inbox |
| 자동 적용 | 처리 결과를 자동으로 적용 | false |

### 유지보수

| 항목 | 설명 | 기본값 |
|------|------|--------|
| 자동 유지보수 | 주기적 백그라운드 실행 | false |
| 주기 (분) | 자동 실행 간격 | 60 |

### 프라이버시 규칙

설정 탭 하단에서 규칙을 추가/삭제/활성화할 수 있습니다. 각 규칙에는 이름, 타입, 패턴, 활성화 토글이 있습니다.

---

## 설치

### 수동 설치

1. [Releases](https://github.com/dhwang0803-glitch/Noluma/releases)에서 최신 버전의 `main.js`, `manifest.json`, `styles.css`를 다운로드합니다.
2. Vault 폴더 내 `.obsidian/plugins/knowledge-maintenance/` 디렉터리를 생성합니다.
3. 다운로드한 3개 파일을 해당 디렉터리에 복사합니다.
4. Obsidian을 재시작하거나 **설정 → 커뮤니티 플러그인**에서 새로고침합니다.
5. **Knowledge Maintenance** 플러그인을 활성화합니다.
6. 설정 탭에서 AI 공급자와 API 키를 설정합니다.

### 소스에서 빌드

```bash
git clone https://github.com/dhwang0803-glitch/Noluma.git
cd Noluma
npm install
npm run build
```

빌드 후 생성되는 `main.js`, `manifest.json`, `styles.css`를 Vault의 플러그인 디렉터리에 복사합니다.

### 모바일 설치

데스크톱과 동일한 3개 파일을 모바일 Vault의 `.obsidian/plugins/knowledge-maintenance/`에 배치합니다.

- **Obsidian Sync 사용 시**: 데스크톱에서 플러그인을 설치하면 모바일로 자동 동기화됩니다.
- **수동 복사 시**: 파일 관리자 또는 USB로 아래 경로에 파일을 복사합니다.
  - Android: `내부 저장소/Documents/Obsidian/[Vault명]/.obsidian/plugins/knowledge-maintenance/`
  - iOS: Files 앱 → Obsidian → [Vault명] → `.obsidian/plugins/knowledge-maintenance/`

---

## 아키텍처

Clean Architecture 기반으로 설계되었습니다. 의존성은 항상 안쪽(도메인)을 향합니다.

```
domain/          ← 순수 비즈니스 로직 (외부 의존 없음)
  models/        ← Note, PrivacyRule, OrganizeResult 등
  values/        ← NotePath, TagName, Timestamp 등 (branded types)
  errors/        ← NoteNotFoundError 등 도메인 에러

application/     ← 유스케이스 + 포트 인터페이스
  usecases/      ← QuickAskUseCase, OrganizeNoteUseCase 등
  ports/         ← AIProviderPort, VaultAccessPort 등 7개 포트

adapters/        ← 포트 구현체 (외부 라이브러리 의존)
  ai/            ← OpenAIAdapter, GeminiAdapter
  vault/         ← ObsidianVaultAdapter
  history/       ← FileHistoryAdapter
  search/        ← JsonSearchIndexAdapter

ui/              ← Obsidian UI 컴포넌트
  QuickAskModal, PluginSettingTab, InboxStatusView, MaintenanceLogView

main.ts          ← Composition Root (모든 의존성 조립)
```

---

## 지원 환경

- Obsidian **1.7.2** 이상
- 데스크톱 (Windows, macOS, Linux)
- 모바일 (Android, iOS)
- AI 공급자: OpenAI API, Google Gemini API

---

## 알려진 한계

### AI 의존성

- **API 키 필수**: 플러그인의 핵심 기능(Quick Ask, 노트 정리, Inbox 처리)은 OpenAI 또는 Gemini API 키가 있어야 동작합니다. API 키 없이는 유지보수(고아 노트, 깨진 링크 탐지) 기능만 사용할 수 있습니다.
- **API 비용 발생**: 모든 AI 호출에 토큰 비용이 발생합니다. 대량의 노트를 처리하거나 자동 유지보수를 짧은 주기로 설정하면 비용이 누적될 수 있습니다.
- **네트워크 필요**: AI 기능은 인터넷 연결이 필요합니다. 오프라인 환경에서는 유지보수 스캔만 가능합니다.

### 검색 인덱스

- 현재 JSON 기반의 단순 검색 인덱스를 사용합니다. 대규모 Vault(1000개 이상 노트)에서는 검색 속도가 느려질 수 있습니다.
- 의미 기반 검색(semantic search)은 지원하지 않으며, 키워드 매칭 기반입니다.

### 중복 탐지

- Jaccard 유사도 기반으로 동작하여 내용이 비슷하지만 표현이 다른 노트는 감지하지 못할 수 있습니다.
- 매우 짧은 노트(몇 단어)는 유사도 계산이 부정확할 수 있습니다.

### 모바일

- 모바일 환경에서 백그라운드 전환 시 진행 중인 AI 호출이 중단될 수 있습니다.
- 클립보드 캡처는 모바일 OS의 클립보드 권한 정책에 따라 동작이 제한될 수 있습니다.

### 프라이버시

- 프라이버시 규칙은 플러그인이 AI에게 보내는 데이터를 제어합니다. API 공급자(OpenAI, Google)의 데이터 처리 정책은 각 공급자의 약관을 확인하세요.
- 내용 마스킹은 정규식 기반이므로 복잡한 패턴의 민감 정보는 별도로 규칙을 추가해야 합니다.

---

## 개발

```bash
npm run dev        # 개발 모드 (watch)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint 검사
npm run test       # 테스트 실행 (vitest)
npm run test:watch # 테스트 감시 모드
```

---

## 라이선스

Copyright © 2026 Noluma for Obsidian. All rights reserved.
