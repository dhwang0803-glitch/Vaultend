import type en from './en';

const ko: { [K in keyof typeof en]: string } = {
  // ─── Plugin ───
  'plugin.name': 'Knowledge Maintenance',

  // ─── Commands ───
  'command.quickAsk': 'Quick Ask',
  'command.captureClipboard': '클립보드 캡처',
  'command.organizeNote': '현재 노트 정리',
  'command.runMaintenance': '유지보수 실행',
  'command.runInbox': 'Inbox 처리',
  'command.openLog': '유지보수 로그 열기',
  'command.openInbox': 'Inbox 상태 열기',
  'command.scanFolder': '이 폴더 유지보수 스캔',

  // ─── Notices ───
  'notice.clipboardSaved': '클립보드 내용을 저장했습니다: {{path}}',
  'notice.clipboardFailed': '클립보드 캡처 실패: {{error}}',
  'notice.organizeResult': '폴더: {{folder}} | 태그: {{tags}}',
  'notice.organizeFailed': '노트 정리 실패: {{error}}',
  'notice.inboxStarted': 'Inbox 처리를 시작합니다...',
  'notice.inboxComplete': 'Inbox 처리 완료: {{processed}}개 처리, {{skipped}}개 건너뜀, {{errors}}개 오류',
  'notice.inboxFailed': 'Inbox 처리 실패: {{error}}',
  'notice.inboxDetected': 'Inbox: {{count}}개 파일 변경 감지',
  'notice.inboxAlreadyRunning': 'Inbox 처리가 이미 실행 중입니다.',
  'notice.dismissed': '이슈를 무시했습니다',
  'notice.actionApplied': '액션을 적용했습니다',
  'notice.actionFailed': '적용 실패: {{error}}',
  'notice.noSelection': '선택된 항목이 없습니다',
  'notice.batchResult': '{{success}}건 적용, {{failed}}건 실패',
  'notice.batchComplete': '{{count}}건 적용 완료',
  'notice.batchDismissed': '{{count}}건 무시 처리',

  // ─── Maintenance Result View ───
  'maintenance.viewTitle': 'Vault 유지보수',
  'maintenance.title': 'Vault 유지보수 결과',
  'maintenance.folderTitle': '유지보수 결과: {{folder}}/',
  'maintenance.scanning': '스캔 중...',
  'maintenance.scanFailed': '스캔 실패: {{error}}',
  'maintenance.runScan': '스캔 실행',
  'maintenance.scanDesc': 'Vault 전체를 분석합니다',
  'maintenance.startScan': '스캔 시작',
  'maintenance.rescan': '다시 스캔',
  'maintenance.lastScan': '마지막 스캔: {{time}}',
  'maintenance.vaultClean': 'Vault 상태가 양호합니다.',
  'maintenance.applied': '적용됨',

  // Issue type labels
  'issue.emptyNotes': '빈 노트 ({{count}})',
  'issue.untaggedNotes': '미태그 노트 ({{count}})',
  'issue.missingTags': '누락 태그 ({{count}})',
  'issue.brokenLinks': '깨진 링크 ({{count}})',
  'issue.orphanNotes': '고아 노트 ({{count}})',
  'issue.duplicates': '중복 후보 ({{count}})',

  // Issue type short labels (for filter chips)
  'issueShort.empty': '빈 노트',
  'issueShort.untagged': '미태그',
  'issueShort.missing-tags': '누락 태그',
  'issueShort.broken-link': '깨진 링크',
  'issueShort.orphan': '고아 노트',
  'issueShort.duplicate': '중복 후보',

  // Summary
  'summary.emptyNotes': '빈 노트 {{count}}',
  'summary.untagged': '미태그 {{count}}',
  'summary.missingTags': '누락 태그 {{count}}',
  'summary.brokenLinks': '깨진 링크 {{count}}',
  'summary.orphanNotes': '고아 노트 {{count}}',
  'summary.duplicates': '중복 후보 {{count}}',

  // Severity
  'severity.critical': '심각',
  'severity.warning': '주의',
  'severity.info': '정보',

  // Buttons
  'btn.open': '열기',
  'btn.archive': '아카이브',
  'btn.delete': '삭제',
  'btn.applyTags': '태그 적용',
  'btn.removeLink': '링크 제거',
  'btn.createNote': '노트 생성',
  'btn.openSideBySide': '나란히 열기',
  'btn.ask': '질문하기',
  'btn.close': '닫기',

  // Batch
  'batch.selectAll': '전체 선택',
  'batch.toggleAll': '전체 선택 / 해제',
  'batch.selectedArchive': '선택 아카이브',
  'batch.selectedDelete': '선택 삭제',
  'batch.selectedDismiss': '선택 무시',
  'batch.selectedRemoveLinks': '선택 링크 제거',
  'batch.selectedApplyTags': '선택 태그 적용',

  // Dismiss
  'dismiss.tooltip': '무시',

  // Impact warning
  'impact.warning': '⚠ 이 노트를 참조하는 {{count}}개 노트: {{names}}{{suffix}}',
  'impact.andMore': ' 외 {{count}}개',

  // Duplicates
  'duplicate.tagSuggestion': '{{tags}} 추가 제안',
  'duplicate.similarity': '유사도 {{score}}%',

  // Undo / Redo
  'undo.tooltip': '실행 취소',
  'redo.tooltip': '다시 실행',
  'undo.success': '실행 취소됨',
  'redo.success': '다시 실행됨',
  'undo.failed': '실행 취소 실패: {{error}}',

  // Filter
  'filter.searchPlaceholder': '경로로 필터...',

  // ─── Maintenance Log View ───
  'log.viewTitle': 'Maintenance Log',
  'log.title': '유지보수 활동 로그',
  'log.empty': '아직 기록된 활동이 없습니다.',
  'log.refresh': '새로고침',
  'log.undo': '복원',

  // ─── Inbox Status View ───
  'inbox.viewTitle': 'Inbox Status',
  'inbox.title': 'Inbox 처리 현황',
  'inbox.total': '총 노트: {{count}}',
  'inbox.unprocessed': '미처리: {{count}}',
  'inbox.processed': '처리완료: {{count}}',

  // ─── Quick Ask Modal ───
  'quickAsk.title': 'Quick Ask',
  'quickAsk.placeholder': '질문을 입력하세요... (Ctrl+Enter로 전송)',
  'quickAsk.askButton': '질문하기',
  'quickAsk.closeButton': '닫기',
  'quickAsk.loading': 'AI에게 질문하는 중...',
  'quickAsk.error': '오류: {{error}}',
  'quickAsk.emptyQuestion': '질문을 입력해주세요.',
  'quickAsk.tokens': '토큰: {{count}}',
  'quickAsk.cost': '비용: ${{amount}}',
  'quickAsk.tags': '태그: {{tags}}',
  'quickAsk.suggestedTags': '제안 태���: {{tags}}',
  'quickAsk.references': '참조된 노트',
  'quickAsk.truncated': '⚠ 토큰 제한으로 응답이 잘렸습니다. 더 구체적인 질문을 시도해보세요.',

  // ─── Organize Result Modal ───
  'organize.title': '노트 정리',
  'organize.category': '분류',
  'organize.summary': '요약',
  'organize.suggestedTags': '제안 태그',
  'organize.suggestedLinks': '제안 링크',
  'organize.suggestedMove': '제안 폴더',
  'organize.noTags': '제안된 태그가 없습니다.',
  'organize.noLinks': '제안된 링크가 없습니다.',
  'organize.noMove': '폴더 이동이 제안되지 않았습니다.',
  'organize.applyTags': '태그 적용',
  'organize.addLinks': '링크 추가',
  'organize.moveNote': '노트 이동',
  'organize.moveTo': '이동 대상',
  'organize.tagsApplied': '{{count}}개 태그 적용됨',
  'organize.linksAdded': '{{count}}개 링크 추가됨',
  'organize.noteMoved': '{{folder}}/로 이동됨',
  'organize.analyzing': 'AI로 노트를 분석 중...',
  'organize.addTagPlaceholder': '태그 추가...',
  'organize.addLinkPlaceholder': '링크 추가 (노트 이름)...',
  'organize.addBtn': '추가',
  'organize.keepCurrent': '— 현재 위치 유지 —',
  'organize.applyAll': '전체 적용',
  'organize.nothingToApply': '적용할 항목이 없습니다.',
  'organize.tokens': '토큰: {{count}}',
  'organize.cost': '비용: ${{amount}}',

  // ─── Inbox Progress Modal ───
  'inboxProgress.title': 'Inbox 처리 중',
  'inboxProgress.counter': '{{current}} / {{total}}',
  'inboxProgress.cancel': '취소',
  'inboxProgress.close': '닫기',
  'inboxProgress.completeTitle': 'Inbox 처리 완료',
  'inboxProgress.cancelledTitle': 'Inbox 처리 취소됨',
  'inboxProgress.processed': '처리됨: {{count}}',
  'inboxProgress.skipped': '건너뜀: {{count}}',
  'inboxProgress.errors': '오류: {{count}}',
  'inboxProgress.errorDetail': '{{path}}: {{error}}',

  // ─── Settings ───
  'settings.title': 'Knowledge Maintenance 설정',

  'settings.language': '언어',
  'settings.locale': '표시 언어',
  'settings.localeDesc': '플러그인 인터페이스 언어를 선택합니다. 명령 팔레트 이름은 재시작 후 적용됩니다.',
  'settings.localeAuto': '자동 (Obsidian 설정 따름)',

  'settings.aiProvider': 'AI 공급자',
  'settings.aiProviderName': 'AI 공급자',
  'settings.aiProviderDesc': '사용할 AI 서비스를 선택합니다.',
  'settings.apiKey': 'API 키',
  'settings.apiKeyDesc': 'AI 공급자의 API 키를 입력합니다.',
  'settings.model': '모델',
  'settings.modelDesc': '사용할 AI 모델을 입력합니다.',

  'settings.inbox': 'Inbox',
  'settings.inboxFolder': 'Inbox 폴더',
  'settings.inboxFolderDesc': '미처리 노트가 수집되는 폴더 경로',
  'settings.autoApply': '자동 적용',
  'settings.autoApplyDesc': 'Inbox 처리 결과를 자동으로 적용합니다.',

  'settings.quickAsk': 'Quick Ask',
  'settings.saveMode': '저장 모드',
  'settings.saveModeDesc': 'Quick Ask 답변의 저장 방식을 선택합니다.',
  'settings.saveModeTimestamp': '타임스탬프 파일명 (질문마다 별도 파일)',
  'settings.saveModeDailyNote': 'Daily Note (하루치를 하나의 파일에 추가)',
  'settings.maxTokens': '최대 응답 토큰',
  'settings.maxTokensDesc': 'AI 응답의 최대 토큰 수 (1024–16384). 높을수록 긴 답변이 가능하지만 비용이 증가합니다.',
  'settings.dailyNoteLimit': 'Daily Note 용량 제한 (KB)',
  'settings.dailyNoteLimitDesc': 'Daily Note 모드에서 파일이 이 크기를 초과하면 새 파일을 생성합니다.',

  'settings.maintenance': '유지보수',
  'settings.autoMaintenance': '자동 유지보수',
  'settings.autoMaintenanceDesc': '주기적으로 Vault 유지보수를 실행합니다.',
  'settings.maintenanceInterval': '유지보수 주기 (분)',
  'settings.maintenanceIntervalDesc': '자동 유지보수 실행 간격',
  'settings.excludeFolders': '스캔 제외 폴더',
  'settings.excludeFoldersDesc': '유지보수 스캔에서 제외할 폴더 (쉼표로 구분)',
  'settings.excludeFiles': '스캔 제외 파일 패턴',
  'settings.excludeFilesDesc': '유지보수 스캔에서 제외할 파일 패턴 (쉼표로 구분, glob 지원)',
  'settings.excludeTags': '스캔 제외 태그',
  'settings.excludeTagsDesc': '이 태그가 있는 노트를 유지보수 스캔에서 제외합니다 (쉼표로 구분)',
  'settings.archiveFolder': '아카이브 폴더',
  'settings.archiveFolderDesc': '노트 아카이브 시 이동할 대상 폴더',

  'settings.search': '검색 (고급)',
  'settings.rrfEmbeddingWeight': '임베딩 가중치',
  'settings.rrfEmbeddingWeightDesc': '하이브리드 검색에서 임베딩 결과의 가중치 배율 (기본: 4.0). 높을수록 의미적 유사성을 우선합니다.',
  'settings.rrfK': 'RRF K 파라미터',
  'settings.rrfKDesc': 'Reciprocal Rank Fusion 스무딩 파라미터 (기본: 20). 낮을수록 순위 차이가 극적으로 반영됩니다.',

  // ─── Domain Errors ───
  'error.noteNotFound': '노트를 찾을 수 없습니다: {{id}}',
  'error.duplicateNote': '이미 존재하는 노트입니다: {{path}}',
  'error.invalidContent': '유효하지 않은 노트 내용: {{reason}}',
  'error.aiProvider': 'AI 오류 [{{provider}}] ({{status}}): {{detail}}',
  'error.privacyViolation': '프라이버시 규칙에 의해 차단: {{rule}}',
  'error.rateLimit': '요청 한도 초과 — {{ms}}ms 후 재시도',
  'error.historyNotFound': '되돌릴 이력 항목을 찾을 수 없습니다: {{id}}',

  'settings.privacy': '프라이버시',
  'settings.privacyDesc': '아래 규칙에 해당하는 노트는 AI에게 전송되지 않습니다.',
  'settings.ruleName': '규칙 이름',
  'settings.ruleAdd': '규칙 추가',
  'settings.ruleDelete': '삭제',
  'settings.ruleNumber': '규칙 {{number}}',
  'settings.ruleTypeFolderExclude': '폴더 제외',
  'settings.ruleTypeTagExclude': '태그 제외',
  'settings.ruleTypeFrontmatterExclude': 'Frontmatter 제외',
  'settings.ruleTypeContentRedact': '내용 마스킹',
};

export default ko;
