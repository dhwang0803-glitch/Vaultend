# Noluma 실환경 QA 테스트 플랜

> 대상 버전: v0.4.9+  
> 테스트 환경: Obsidian Desktop (Windows/Mac), BRAT 설치  
> 전제: Settings에서 AI Provider API 키 설정 완료

---

## 0. 사전 준비

### Vault 구조 확인

```
Vault/
├── Inbox/           ← inboxFolder (미분류 노트 2~3개 배치)
├── Projects/        ← 정리된 노트 5+개
├── Knowledge/       ← 태그 있는 노트 5+개
├── Archive/         ← 빈 파일 1개, 태그 없는 파일 1개
└── Daily/           ← Daily Note 폴더
```

### Settings 설정값

| 설정 | 값 |
|------|-----|
| AI Provider | gemini (또는 openai) |
| API Key | 유효한 키 |
| Inbox Folder | `Inbox` |
| Default Save Folder | `Quick Ask` |
| Save Mode | `timestamp` |
| Embeddings Enabled | `true` |
| Maintenance Enabled | `true` |
| Exclude Folders | `Archive` |
| Locale | `auto` |

---

## 1. Quick Ask (핵심 기능)

### TC-1.1: 기본 질의 + 참조 노트 출처 표시

| 항목 | 내용 |
|------|------|
| 실행 | Command Palette → "Quick Ask" |
| 입력 | "React hooks의 규칙 3가지를 설명해줘" |
| 기대 | 모달에 마크다운 응답 표시, 토큰/비용 하단에 표시 |
| 확인 | ✅ 응답 아래에 **"Referenced Notes"** 섹션이 표시되는지 |
| 확인 | ✅ 참조된 vault 노트 이름이 클릭 가능한 링크로 나열되는지 |
| 확인 | ✅ 참조 노트 클릭 시 **새 탭**에서 열리고 모달은 유지되는지 |
| 확인 | ✅ 저장된 파일 이름 버튼이 표시되는지 |
| 확인 | ✅ 파일 버튼 클릭 시 해당 노트로 이동 (모달 닫힘) |

### TC-1.2: Ctrl+Enter 단축키

| 항목 | 내용 |
|------|------|
| 실행 | Quick Ask 모달에서 질문 입력 후 Ctrl+Enter |
| 기대 | 버튼 클릭 없이 질의 실행됨 |

### TC-1.3: 빈 질문 예외

| 항목 | 내용 |
|------|------|
| 실행 | Quick Ask → 빈 상태에서 "Ask" 클릭 |
| 기대 | Notice로 "질문을 입력하세요" 표시 |

### TC-1.4: 태그 자동 추출 (Suggested Tags 라벨)

| 항목 | 내용 |
|------|------|
| 실행 | Quick Ask → vault에 있는 주제 질문 (예: "TypeScript 제네릭") |
| 기대 | 응답 하단에 **"Suggested Tags: ..."** 라벨로 표시 (기존 "Tags:" 아님) |
| 확인 | ✅ 태그가 vault에 이미 존재하는 것 위주인지 |
| 확인 | ✅ 공백/특수문자 포함 태그가 하이픈으로 치환되어 유효한 형식인지 (예: `#코드 시각화` → `#코드-시각화`) |
| 확인 | ✅ 저장된 파일의 frontmatter `tags:` 필드에 정상 기록되는지 |

### TC-1.5: 참조 노트 링크 자동 추가 + wikilink 폴더 독립성

| 항목 | 내용 |
|------|------|
| 실행 | Quick Ask → vault 노트를 참조할 수 있는 질문 |
| 기대 (링크 자동 추가) | AI 응답에 [[wikilink]]가 없어도, 참조된 노트가 저장 파일의 `## References` 섹션에 자동 추가됨 |
| 확인 | ✅ 저장된 파일에 `## References` 섹션이 있고 `[[노트이름]]` 형식 링크가 있는지 |
| 확인 | ✅ wikilink가 **폴더 경로 없이 basename만** 사용하는지 (예: `[[hooks]]`, NOT `[[Projects/hooks]]`) |
| 확인 | ✅ vault에 동일 이름 파일이 여러 개 있으면 폴더 접두사가 붙는지 (예: `[[projects/hooks]]`) |
| 기대 (AI 링크) | AI가 [[wikilink]]를 응답에 직접 포함하면 그것이 suggestedLinks로 우선 사용됨 |

### TC-1.6: Daily Note 모드 저장 + 깨진 링크 방지

| 항목 | 내용 |
|------|------|
| 설정 | Save Mode → `daily-note` |
| 실행 | Quick Ask → 외부 URL을 참조할 법한 질문 (예: "React 공식 문서 링크 알려줘") |
| 기대 | Daily Note에 섹션으로 추가됨 (기존 내용 유지) |
| 확인 | ✅ 파일 사이즈 리밋 초과 시 새 파일 생성되는지 (예: `2026-07-14-2.md`) |
| 확인 | ✅ AI 응답의 마크다운 URL 링크 `[text](http...)` 가 vault에 깨진 링크를 생성하지 않는지 |
| 확인 | ✅ 저장된 파일에서 Obsidian의 "깨진 링크" 목록에 외부 URL이 나타나지 않는지 |

### TC-1.7: Hybrid Search (Embedding + BM25)

| 항목 | 내용 |
|------|------|
| 전제 | Embeddings Enabled = true, 임베딩 초기화 완료 |
| 실행 | Quick Ask → 의미적으로 유사하지만 키워드가 다른 질문 |
| 예시 | "함수형 프로그래밍에서 부수효과를 피하는 방법" (vault에 "순수 함수" 노트 있을 때) |
| 기대 | BM25만으로 못 찾을 노트도 context에 포함됨 |
| 확인 | ✅ Referenced Notes에 의미적으로 유사한 노트가 포함되는지 |

### TC-1.8: 긴 응답 잘림 감지 (토큰 제한)

| 항목 | 내용 |
|------|------|
| 전제 | Settings → Max Response Tokens 기본값 4096 (또는 테스트용으로 1024로 낮춤) |
| 실행 | Quick Ask → 매우 긴 응답을 유발하는 질문 (예: "React 기술 스택의 상세한 사용법을 전부 카테고리 별로 초보자 가이드 수준으로 보여줘") |
| 기대 | 응답이 토큰 제한으로 잘릴 경우 모달 상단에 **경고 배너** 표시 |
| 확인 | ✅ 경고 메시지: "토큰 제한으로 응답이 잘렸습니다. 더 구체적인 질문을 시도해보세요." |
| 확인 | ✅ 저장된 파일에 `> [!warning] Response truncated due to token limit.` callout 포함 |
| 확인 | ✅ 잘리지 않은 정상 응답에는 경고가 표시되지 않는지 |
| 확인 | ✅ Settings에서 토큰을 8192 이상으로 올리면 같은 질문이 잘리지 않는지 |

### TC-1.9: BM25 검색 인덱스 동작 확인

| 항목 | 내용 |
|------|------|
| 전제 | 플러그인 재시작 직후 (인덱스 rebuild 확인) |
| 실행 | Quick Ask → vault에 확실히 존재하는 키워드로 질문 |
| 기대 | Referenced Notes에 해당 키워드를 포함한 노트가 표시됨 |
| 확인 | ✅ 플러그인 시작 시 콘솔에 "search index built (N notes)" 로그 확인 |
| 확인 | ✅ 새 노트 생성 후 바로 Quick Ask하면 해당 노트가 검색되는지 (incremental indexing) |
| 확인 | ✅ 노트 삭제/이름 변경 후 검색에서 사라지는지 |

---

## 2. Organize Current Note (AI 분류/태깅)

### TC-2.1: 기본 분류

| 항목 | 내용 |
|------|------|
| 준비 | Inbox에 태그/분류 없는 노트 열기 |
| 실행 | Command Palette → "Organize Current Note" |
| 기대 | 모달 표시: 요약, 제안 태그, 제안 링크, 이동 폴더 (카테고리 없음) |
| 확인 | ✅ "Analyzing..." Notice → 모달 전환 |
| 확인 | ✅ AI가 항상 폴더를 추천하며, 새 폴더인 경우 "(New)" 표시가 붙는지 |

### TC-2.2: 태그 제안 품질 + sanitize

| 항목 | 내용 |
|------|------|
| 확인 | 제안 태그가 vault 기존 태그를 재사용하는지 |
| 확인 | 노트 내용과 무관한 태그(hallucination)가 없는지 |
| 확인 | 태그 수가 3~5개 범위인지 |
| 확인 | ✅ AI가 공백이 포함된 태그를 제안해도 저장 시 공백이 하이픈으로 변환되는지 (예: "machine learning" → "machine-learning") |

### TC-2.3: 태그 수동 추가/제거

| 항목 | 내용 |
|------|------|
| 실행 | 모달에서 × 클릭으로 태그 제거, 입력란에 새 태그 추가 |
| 기대 | chip UI가 즉시 갱신됨 |

### TC-2.4: 링크 제안

| 항목 | 내용 |
|------|------|
| 확인 | 제안된 링크가 실제 존재하는 노트인지 |
| 확인 | 링크 경로에 .md 확장자가 표시되지 않는지 ([[Note Name]] 형식) |

### TC-2.5: 폴더 이동 제안

| 항목 | 내용 |
|------|------|
| 확인 | AI가 항상 이동 폴더를 추천하는지 (folder 필드가 항상 존재) |
| 확인 | 드롭다운에 vault의 실제 폴더 목록이 표시되는지 |
| 확인 | AI가 추천한 폴더가 vault에 없으면 "(New)" 라벨이 표시되는지 |
| 확인 | "Keep current" 옵션이 기본 선택인지 (suggestedMove 없을 때) |
| 확인 | ✅ (New) 폴더 선택 후 Apply 시 해당 폴더가 자동 생성되고 노트가 이동되는지 |

### TC-2.6: Apply All

| 항목 | 내용 |
|------|------|
| 실행 | 태그 3개 + 링크 1개 + 폴더 선택 후 "Apply All" |
| 기대 | Notice에 적용 결과 표시, 노트 frontmatter에 태그 추가됨 |
| 확인 | ✅ 노트가 선택한 폴더로 이동됨 |
| 확인 | ✅ Related Notes 섹션에 링크 추가됨 |

### TC-2.7: 토큰/비용 표시

| 항목 | 내용 |
|------|------|
| 확인 | 모달 하단에 토큰 수와 비용($)이 표시되는지 |

### TC-2.8: 빈 vault 태그 생성 프롬프트

| 항목 | 내용 |
|------|------|
| 준비 | 태그가 전혀 없는 vault (또는 빈 vault에 노트 1개) |
| 실행 | Organize Current Note |
| 기대 | 3개 이상의 새 태그를 생성하여 제안 |

---

## 3. Run Maintenance (Vault 건강 점검)

### TC-3.1: 전체 스캔

| 항목 | 내용 |
|------|------|
| 실행 | Command Palette → "Run Maintenance" |
| 기대 | Maintenance Results 뷰에 결과 표시 |
| 확인 | ✅ 심각도 뱃지 (high/medium/low) 표시 |
| 확인 | ✅ 필터 (All/High/Medium/Low) 동작 |

### TC-3.2: 고아 노트 탐지

| 항목 | 내용 |
|------|------|
| 준비 | 어디서도 링크되지 않은 노트 1개 생성 |
| 기대 | "Orphaned notes" 섹션에 표시됨 |

### TC-3.3: 깨진 링크 탐지

| 항목 | 내용 |
|------|------|
| 준비 | 존재하지 않는 [[Non Existent Note]] 링크를 가진 노트 |
| 기대 | "Broken links" 섹션에 표시됨 |
| 확인 | ✅ 링크 소스 노트와 대상 경로가 모두 표시되는지 |

### TC-3.4: 중복 노트 탐지

| 항목 | 내용 |
|------|------|
| 준비 | 제목이 매우 유사한 노트 2개 (예: "React Guide", "React 가이드") |
| 기대 | "Potential duplicates" 섹션에 쌍으로 표시됨 |

### TC-3.5: 빈 파일 탐지

| 항목 | 내용 |
|------|------|
| 준비 | 내용이 없는(또는 frontmatter만 있는) .md 파일 |
| 기대 | "Empty notes" 섹션에 표시됨 |

### TC-3.6: 태그 없는 파일 탐지

| 항목 | 내용 |
|------|------|
| 준비 | frontmatter에 tags 필드가 없는 노트 |
| 기대 | "Untagged notes" 섹션에 표시됨 |

### TC-3.7: 제외 폴더 동작

| 항목 | 내용 |
|------|------|
| 설정 | Exclude Folders에 "Archive" 추가 |
| 준비 | Archive/ 폴더에 고아/빈 노트 배치 |
| 기대 | Archive 내 파일이 결과에 나타나지 않음 |

### TC-3.8: Smart Scheduling + 첫 실행 보장

| 항목 | 내용 |
|------|------|
| 설정 | Smart Scheduling = true, Interval = 30분 |
| 실행 | 아무 노트도 수정하지 않고 30분 대기 (또는 타이머 확인) |
| 기대 | dirty set이 비어있으면 스캔을 건너뜀 (콘솔 로그 확인) |
| 확인 | ✅ `lastScanTimestamp`가 null (한 번도 실행한 적 없음)이면 dirty set이 비어있어도 첫 스캔이 실행되는지 |
| 확인 | ✅ 첫 실행 후에는 dirty set이 비어있을 때 정상적으로 건너뛰는지 |

### TC-3.9: Dismiss 복구 (Undo 버튼)

| 항목 | 내용 |
|------|------|
| 준비 | Run Maintenance 실행하여 결과가 있는 상태 |
| 실행 | 임의의 항목에서 "Dismiss" 버튼 클릭 |
| 기대 | 항목이 사라지지 않고, **취소선** + **Undo 버튼**(빨간색)이 표시됨 |
| 확인 | ✅ 취소선이 텍스트(제목/설명)에만 적용되고 버튼에는 적용되지 않는지 |
| 확인 | ✅ Undo 클릭 시 항목이 원래 상태로 복원되는지 |
| 확인 | ✅ 일괄 Dismiss도 동일한 취소선 + Undo 패턴으로 동작하는지 |

### TC-3.10: Archive 복원 (원래 위치로 이동)

| 항목 | 내용 |
|------|------|
| 준비 | 고아 노트 또는 빈 노트가 탐지된 상태 |
| 실행 | Archive 버튼 클릭 → Activity Log 열기 |
| 기대 | 로그에 archive 항목이 기록되고, **빨간색 Restore 버튼** 표시 |
| 확인 | ✅ Restore 클릭 시 노트가 원래 위치로 이동되는지 |
| 확인 | ✅ 복원 후 로그에 "복원" 항목이 추가되는지 |

### TC-3.11: Restore 버튼 UI

| 항목 | 내용 |
|------|------|
| 준비 | Delete 또는 Archive 액션을 실행한 후 Maintenance Results에서 확인 |
| 실행 | 적용된 항목의 Restore 버튼 확인 |
| 기대 | Restore 버튼이 **빨간색(warning)** 스타일이고 취소선에 가려지지 않음 |
| 확인 | ✅ 취소선이 설명 텍스트에만 적용되고 Restore 버튼 텍스트에는 적용되지 않는지 |

---

## 4. Organize Folder (폴더 정리)

### TC-4.1: Command Palette에서 폴더 선택 + 처리

| 항목 | 내용 |
|------|------|
| 준비 | 임의 폴더에 미분류 노트 3개 배치 |
| 실행 | Command Palette → "Organize Folder" |
| 기대 | **Fuzzy Search 폴더 선택 모달** 표시 |
| 확인 | ✅ vault의 모든 폴더가 목록에 표시되는지 (하위 폴더 포함) |
| 확인 | ✅ vault root가 "/ (Vault Root)" 로 표시되는지 |
| 확인 | ✅ 폴더 선택 시 **프로그레스 모달** 표시 (모달 제목에 선택한 폴더명 포함) |
| 확인 | ✅ 프로그레스 바, 카운터, 현재 노트명이 표시되는지 |
| 확인 | ✅ 완료 시 요약 화면 표시 |
| 확인 | ✅ 각 노트에 태그가 추가되고 frontmatter에 `processed: true` 마킹되는지 |

### TC-4.2: 우클릭 컨텍스트 메뉴에서 폴더 정리

| 항목 | 내용 |
|------|------|
| 준비 | 미분류 노트가 있는 폴더 |
| 실행 | 해당 폴더를 우클릭 → "Organize Folder" |
| 기대 | 폴더 선택 없이 바로 **프로그레스 모달** 표시 (선택한 폴더 자동 적용) |
| 확인 | ✅ 모달 제목에 우클릭한 폴더명이 표시되는지 |
| 확인 | ✅ 해당 폴더의 노트만 처리되는지 |

### TC-4.3: 취소 (Cancel / ESC)

| 항목 | 내용 |
|------|------|
| 준비 | 미분류 노트 5개 이상이 있는 폴더 |
| 실행 | "Organize Folder" → 처리 중 Cancel 버튼 클릭 (또는 ESC) |
| 기대 | 현재 노트 처리 완료 후 중단, 요약 화면에 취소 타이틀 |
| 확인 | ✅ 취소 전까지 처리된 노트 수와 남은 미처리 노트 수가 합산 정확한지 |
| 확인 | ✅ 취소 후 다시 실행하면 나머지 노트만 처리하는지 |

### TC-4.4: 이중 실행 방지

| 항목 | 내용 |
|------|------|
| 실행 | "Organize Folder" 모달 열린 상태에서 다시 실행 |
| 기대 | Notice: "Inbox processing is already running." |
| 확인 | ✅ 두 번째 모달이 열리지 않고, 기존 모달이 정상 계속 동작하는지 |

### TC-4.5: Vault Root 선택 시 정상 동작

| 항목 | 내용 |
|------|------|
| 실행 | "Organize Folder" → 목록에서 "/ (Vault Root)" 선택 |
| 기대 | vault root 최상위 노트들이 정상 처리됨 (에러 없음) |
| 확인 | ✅ 경로 정규화로 인한 오류가 발생하지 않는지 |

### TC-4.6: 자동 감지 (Inbox Watcher)

| 항목 | 내용 |
|------|------|
| 설정 | Auto-Apply Inbox = true |
| 실행 | Inbox/ 폴더에 새 노트 생성 |
| 기대 | 자동으로 분류 실행 (몇 초 뒤 태그 추가됨), "file changes detected" 알림 없음 |
| 확인 | ✅ 자체 처리로 발생한 vault 이벤트가 추가 알림을 트리거하지 않는지 |

### TC-4.7: 에러 표시

| 항목 | 내용 |
|------|------|
| 준비 | 대상 폴더에 노트 3개 배치 (1개는 처리 중 에러 유발 가능한 상태) |
| 실행 | "Organize Folder" |
| 기대 | 완료 화면에 "Errors: 1" 표시 + 에러 리스트에 노트명과 에러 메시지 |
| 확인 | ✅ 에러 난 노트 외의 나머지는 정상 처리되는지 |

### TC-4.8: 노트 이동 후 processed 마킹

| 항목 | 내용 |
|------|------|
| 설정 | Auto-Apply Inbox = true |
| 준비 | 대상 폴더에 노트 배치 (AI가 다른 폴더로 이동 제안할 만한 내용) |
| 실행 | "Organize Folder" |
| 기대 | 노트가 이동된 후에도 에러 없이 정상 완료 |
| 확인 | ✅ 이동된 노트의 frontmatter에 `processed: true`가 있는지 |
| 확인 | ✅ 원래 경로에 NoteNotFoundError가 발생하지 않는지 (콘솔 확인) |

### TC-4.9: Confidence Gating

| 항목 | 내용 |
|------|------|
| 설정 | Inbox Confidence Threshold = 0.7 |
| 준비 | 매우 짧은(모호한) 노트 (예: "TODO") |
| 기대 | low confidence로 판단되어 태그/이동 적용 안 됨 |

---

## 5. Capture Clipboard

### TC-5.1: 텍스트 클립보드

| 항목 | 내용 |
|------|------|
| 준비 | 클립보드에 텍스트 복사 |
| 실행 | Command Palette → "Capture Clipboard" |
| 기대 | 새 노트로 저장되고 Notice 표시 |

---

## 6. History & Undo

### TC-6.1: 이력 조회

| 항목 | 내용 |
|------|------|
| 실행 | Command Palette → "Open Maintenance Log" |
| 기대 | 최근 실행 이력(시간, 액션, 설명) 목록 표시 |

### TC-6.2: Undo (콘텐츠 복원)

| 항목 | 내용 |
|------|------|
| 전제 | Organize 또는 Delete 처리로 변경된 노트가 있을 때 |
| 실행 | Maintenance Log에서 **빨간색 Restore 버튼** 클릭 |
| 기대 | 이전 상태로 복원됨, Notice "Undo 성공" |
| 확인 | ✅ Restore 버튼이 빨간색(warning 스타일)인지 |

### TC-6.3: Archive 복원

| 항목 | 내용 |
|------|------|
| 전제 | Archive 액션으로 노트를 아카이브 폴더로 이동한 상태 |
| 실행 | Maintenance Log에서 archive 항목의 **Restore 버튼** 클릭 |
| 기대 | 노트가 아카이브 폴더에서 원래 위치로 이동됨 |
| 확인 | ✅ 복원 후 원래 경로에 노트가 존재하는지 |
| 확인 | ✅ 아카이브 폴더에서 해당 노트가 사라졌는지 |
| 확인 | ✅ 로그에 "복원" 항목이 추가되는지 |

---

## 7. Settings UI

### TC-7.1: AI Provider 전환

| 항목 | 내용 |
|------|------|
| 실행 | Settings → AI Provider를 OpenAI ↔ Gemini 전환 |
| 기대 | 모델 목록이 provider에 맞게 변경됨 |
| 확인 | ✅ 전환 후 Quick Ask 정상 동작 |

### TC-7.2: Privacy Rules

| 항목 | 내용 |
|------|------|
| 실행 | Privacy Rules → "Add folder-exclude" → pattern: "private/" |
| 확인 | Quick Ask에서 private/ 폴더 노트가 context에 포함되지 않음 |

### TC-7.3: content-redact 규칙

| 항목 | 내용 |
|------|------|
| 설정 | content-redact 규칙 추가: pattern `password:\S+` |
| 준비 | 노트에 "password:abc123" 포함 |
| 실행 | Quick Ask로 해당 노트 참조 유도 |
| 확인 | AI에 보내진 프롬프트에 패스워드가 마스킹됨 ([REDACTED]) |

### TC-7.4: Locale 전환

| 항목 | 내용 |
|------|------|
| 실행 | Locale을 en → ko (또는 ko → en) 변경 후 Obsidian 재시작 |
| 기대 | 모든 UI 텍스트가 해당 언어로 표시됨 |

### TC-7.5: Max Response Tokens 슬라이더

| 항목 | 내용 |
|------|------|
| 실행 | Settings → Quick Ask → "Max Response Tokens" 슬라이더 확인 |
| 기대 | 기본값 4096, 범위 1024~16384 (1024 단위), 드래그 시 툴팁에 현재 값 표시 |
| 확인 | ✅ 슬라이더를 2048으로 낮춘 후 Quick Ask에서 긴 질문 시 더 빨리 잘리는지 |
| 확인 | ✅ 슬라이더를 8192로 올린 후 긴 답변이 잘리지 않고 완전히 출력되는지 |
| 확인 | ✅ 설정 변경 후 Obsidian 재시작 없이 즉시 반영되는지 |

---

## 8. Edge Cases & 에러 핸들링

### TC-8.1: API 키 미설정

| 항목 | 내용 |
|------|------|
| 설정 | AI API Key 비우기 |
| 실행 | Quick Ask 또는 Organize |
| 기대 | 명확한 에러 메시지 (i18n) 표시, 크래시 없음 |

### TC-8.2: 네트워크 오류

| 항목 | 내용 |
|------|------|
| 실행 | 인터넷 연결 끊은 상태에서 Quick Ask |
| 기대 | 타임아웃 후 에러 Notice 표시, 플러그인 정상 유지 |

### TC-8.3: 존재하지 않는 노트에 Organize

| 항목 | 내용 |
|------|------|
| 실행 | 노트 열지 않은 상태에서 Organize Current Note 시도 |
| 기대 | 커맨드가 비활성(checkCallback false) — 팔레트에 안 나옴 |

### TC-8.4: 매우 긴 노트

| 항목 | 내용 |
|------|------|
| 준비 | 10,000자 이상의 긴 노트 |
| 실행 | Organize Current Note |
| 기대 | 정상 처리 (chunk 분할 후 일부만 AI에 전송) |

---

## 결과 기록 템플릿

| TC# | 결과 | 비고 |
|-----|------|------|
| TC-1.1 | PASS / FAIL | |
| TC-1.2 | PASS / FAIL | |
| TC-1.3 | PASS / FAIL | |
| TC-1.4 | PASS / FAIL | |
| TC-1.5 | PASS / FAIL | |
| TC-1.6 | PASS / FAIL | |
| TC-1.7 | PASS / FAIL | |
| TC-1.8 | PASS / FAIL | |
| TC-1.9 | PASS / FAIL | |
| TC-2.1 | PASS / FAIL | |
| TC-2.2 | PASS / FAIL | |
| TC-2.3 | PASS / FAIL | |
| TC-2.4 | PASS / FAIL | |
| TC-2.5 | PASS / FAIL | |
| TC-2.6 | PASS / FAIL | |
| TC-2.7 | PASS / FAIL | |
| TC-2.8 | PASS / FAIL | |
| TC-3.1 | PASS / FAIL | |
| TC-3.2 | PASS / FAIL | |
| TC-3.3 | PASS / FAIL | |
| TC-3.4 | PASS / FAIL | |
| TC-3.5 | PASS / FAIL | |
| TC-3.6 | PASS / FAIL | |
| TC-3.7 | PASS / FAIL | |
| TC-3.8 | PASS / FAIL | |
| TC-3.9 | PASS / FAIL | Dismiss 복구 |
| TC-3.10 | PASS / FAIL | Archive 복원 |
| TC-3.11 | PASS / FAIL | Restore 버튼 UI |
| TC-4.1 | PASS / FAIL | Command Palette 폴더 선택 |
| TC-4.2 | PASS / FAIL | 우클릭 컨텍스트 메뉴 |
| TC-4.3 | PASS / FAIL | 취소 |
| TC-4.4 | PASS / FAIL | 이중 실행 방지 |
| TC-4.5 | PASS / FAIL | Vault Root 선택 |
| TC-4.6 | PASS / FAIL | 자동 감지 |
| TC-4.7 | PASS / FAIL | 에러 표시 |
| TC-4.8 | PASS / FAIL | 노트 이동 후 마킹 |
| TC-4.9 | PASS / FAIL | Confidence Gating |
| TC-5.1 | PASS / FAIL | |
| TC-6.1 | PASS / FAIL | |
| TC-6.2 | PASS / FAIL | 콘텐츠 복원 |
| TC-6.3 | PASS / FAIL | Archive 복원 |
| TC-7.1 | PASS / FAIL | |
| TC-7.2 | PASS / FAIL | |
| TC-7.3 | PASS / FAIL | |
| TC-7.4 | PASS / FAIL | |
| TC-7.5 | PASS / FAIL | |
| TC-8.1 | PASS / FAIL | |
| TC-8.2 | PASS / FAIL | |
| TC-8.3 | PASS / FAIL | |
| TC-8.4 | PASS / FAIL | |
