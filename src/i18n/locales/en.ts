const en = {
  // ─── Plugin ───
  'plugin.name': 'Knowledge Maintenance',

  // ─── Commands ───
  'command.quickAsk': 'Quick Ask',
  'command.captureClipboard': 'Capture Clipboard',
  'command.organizeNote': 'Organize Current Note',
  'command.runMaintenance': 'Run Maintenance',
  'command.runInbox': 'Process Inbox',
  'command.openLog': 'Open Maintenance Log',
  'command.openInbox': 'Open Inbox Status',
  'command.scanFolder': 'Scan this folder for maintenance',

  // ─── Notices ───
  'notice.clipboardSaved': 'Clipboard saved: {{path}}',
  'notice.clipboardFailed': 'Clipboard capture failed: {{error}}',
  'notice.organizeResult': 'Category: {{category}} | Tags: {{tags}}',
  'notice.organizeFailed': 'Note organize failed: {{error}}',
  'notice.inboxStarted': 'Starting Inbox processing...',
  'notice.inboxComplete': 'Inbox complete: {{processed}} processed, {{skipped}} skipped, {{errors}} errors',
  'notice.inboxFailed': 'Inbox processing failed: {{error}}',
  'notice.inboxDetected': 'Inbox: {{count}} file changes detected',
  'notice.dismissed': 'Issue dismissed',
  'notice.actionApplied': 'Action applied',
  'notice.actionFailed': 'Action failed: {{error}}',
  'notice.noSelection': 'No items selected',
  'notice.batchResult': '{{success}} applied, {{failed}} failed',
  'notice.batchComplete': '{{count}} applied',
  'notice.batchDismissed': '{{count}} dismissed',

  // ─── Maintenance Result View ───
  'maintenance.viewTitle': 'Vault Maintenance',
  'maintenance.title': 'Vault Maintenance Results',
  'maintenance.folderTitle': 'Maintenance Results: {{folder}}/',
  'maintenance.scanning': 'Scanning...',
  'maintenance.scanFailed': 'Scan failed: {{error}}',
  'maintenance.runScan': 'Run Scan',
  'maintenance.scanDesc': 'Analyze the entire vault',
  'maintenance.startScan': 'Start Scan',
  'maintenance.rescan': 'Re-scan',
  'maintenance.lastScan': 'Last scan: {{time}}',
  'maintenance.vaultClean': 'Vault is in good shape.',
  'maintenance.applied': 'Applied',

  // Issue type labels
  'issue.emptyNotes': 'Empty Notes ({{count}})',
  'issue.untaggedNotes': 'Untagged Notes ({{count}})',
  'issue.missingTags': 'Missing Tags ({{count}})',
  'issue.brokenLinks': 'Broken Links ({{count}})',
  'issue.orphanNotes': 'Orphan Notes ({{count}})',
  'issue.duplicates': 'Duplicate Candidates ({{count}})',

  // Issue type short labels (for filter chips)
  'issueShort.empty': 'Empty',
  'issueShort.untagged': 'Untagged',
  'issueShort.missing-tags': 'Missing Tags',
  'issueShort.broken-link': 'Broken Links',
  'issueShort.orphan': 'Orphans',
  'issueShort.duplicate': 'Duplicates',

  // Summary
  'summary.emptyNotes': 'empty {{count}}',
  'summary.untagged': 'untagged {{count}}',
  'summary.missingTags': 'missing tags {{count}}',
  'summary.brokenLinks': 'broken links {{count}}',
  'summary.orphanNotes': 'orphans {{count}}',
  'summary.duplicates': 'duplicates {{count}}',

  // Severity
  'severity.critical': 'Critical',
  'severity.warning': 'Warning',
  'severity.info': 'Info',

  // Buttons
  'btn.open': 'Open',
  'btn.archive': 'Archive',
  'btn.delete': 'Delete',
  'btn.applyTags': 'Apply Tags',
  'btn.removeLink': 'Remove Link',
  'btn.createNote': 'Create Note',
  'btn.openSideBySide': 'Open Side by Side',
  'btn.ask': 'Ask',
  'btn.close': 'Close',

  // Batch
  'batch.selectAll': 'Select All',
  'batch.toggleAll': 'Select / Deselect All',
  'batch.selectedArchive': 'Archive Selected',
  'batch.selectedDelete': 'Delete Selected',
  'batch.selectedDismiss': 'Dismiss Selected',
  'batch.selectedRemoveLinks': 'Remove Selected Links',
  'batch.selectedApplyTags': 'Apply Tags to Selected',

  // Dismiss
  'dismiss.tooltip': 'Dismiss',

  // Impact warning
  'impact.warning': '⚠ Referenced by {{count}} notes: {{names}}{{suffix}}',
  'impact.andMore': ' and {{count}} more',

  // Duplicates
  'duplicate.tagSuggestion': '{{tags}} suggested',
  'duplicate.similarity': 'Similarity {{score}}%',

  // Undo / Redo
  'undo.tooltip': 'Undo',
  'redo.tooltip': 'Redo',
  'undo.success': 'Undone',
  'redo.success': 'Redone',
  'undo.failed': 'Undo failed: {{error}}',

  // Filter
  'filter.searchPlaceholder': 'Filter by path...',

  // ─── Maintenance Log View ───
  'log.viewTitle': 'Maintenance Log',
  'log.title': 'Maintenance Activity Log',
  'log.empty': 'No activity recorded yet.',
  'log.refresh': 'Refresh',
  'log.undo': 'Restore',

  // ─── Inbox Status View ───
  'inbox.viewTitle': 'Inbox Status',
  'inbox.title': 'Inbox Processing Status',
  'inbox.total': 'Total notes: {{count}}',
  'inbox.unprocessed': 'Unprocessed: {{count}}',
  'inbox.processed': 'Processed: {{count}}',

  // ─── Quick Ask Modal ───
  'quickAsk.title': 'Quick Ask',
  'quickAsk.placeholder': 'Enter your question... (Ctrl+Enter to send)',
  'quickAsk.askButton': 'Ask',
  'quickAsk.closeButton': 'Close',
  'quickAsk.loading': 'Asking AI...',
  'quickAsk.error': 'Error: {{error}}',
  'quickAsk.emptyQuestion': 'Please enter a question.',
  'quickAsk.tokens': 'Tokens: {{count}}',
  'quickAsk.cost': 'Cost: ${{amount}}',
  'quickAsk.tags': 'Tags: {{tags}}',

  // ─── Organize Result Modal ───
  'organize.title': 'Organize Note',
  'organize.category': 'Category',
  'organize.summary': 'Summary',
  'organize.suggestedTags': 'Suggested Tags',
  'organize.suggestedLinks': 'Suggested Links',
  'organize.suggestedMove': 'Suggested Folder',
  'organize.noTags': 'No tags suggested.',
  'organize.noLinks': 'No links suggested.',
  'organize.noMove': 'No folder move suggested.',
  'organize.applyTags': 'Apply Tags',
  'organize.addLinks': 'Add Links',
  'organize.moveNote': 'Move Note',
  'organize.moveTo': 'Move to',
  'organize.tagsApplied': '{{count}} tags applied',
  'organize.linksAdded': '{{count}} links added',
  'organize.noteMoved': 'Moved to {{folder}}/',
  'organize.analyzing': 'Analyzing note with AI...',
  'organize.addTagPlaceholder': 'Add tag...',
  'organize.addLinkPlaceholder': 'Add link (note name)...',
  'organize.addBtn': 'Add',
  'organize.keepCurrent': '— Keep current location —',
  'organize.applyAll': 'Apply All',
  'organize.nothingToApply': 'Nothing to apply.',

  // ─── Settings ───
  'settings.title': 'Knowledge Maintenance Settings',

  'settings.language': 'Language',
  'settings.locale': 'Display Language',
  'settings.localeDesc': 'Select the language for the plugin interface. Command palette names update after restart.',
  'settings.localeAuto': 'Auto (follow Obsidian)',

  'settings.aiProvider': 'AI Provider',
  'settings.aiProviderName': 'AI Provider',
  'settings.aiProviderDesc': 'Select the AI service to use.',
  'settings.apiKey': 'API Key',
  'settings.apiKeyDesc': 'Enter the AI provider API key.',
  'settings.model': 'Model',
  'settings.modelDesc': 'Enter the AI model to use.',

  'settings.inbox': 'Inbox',
  'settings.inboxFolder': 'Inbox Folder',
  'settings.inboxFolderDesc': 'Folder path for unprocessed notes',
  'settings.autoApply': 'Auto Apply',
  'settings.autoApplyDesc': 'Automatically apply Inbox processing results.',

  'settings.quickAsk': 'Quick Ask',
  'settings.saveMode': 'Save Mode',
  'settings.saveModeDesc': 'Choose how Quick Ask answers are saved.',
  'settings.saveModeTimestamp': 'Timestamp filename (separate file per question)',
  'settings.saveModeDailyNote': 'Daily Note (append to one file per day)',
  'settings.dailyNoteLimit': 'Daily Note Size Limit (KB)',
  'settings.dailyNoteLimitDesc': 'Create a new file when Daily Note exceeds this size.',

  'settings.maintenance': 'Maintenance',
  'settings.autoMaintenance': 'Auto Maintenance',
  'settings.autoMaintenanceDesc': 'Run vault maintenance periodically.',
  'settings.maintenanceInterval': 'Maintenance Interval (min)',
  'settings.maintenanceIntervalDesc': 'Interval for automatic maintenance',
  'settings.excludeFolders': 'Exclude Folders',
  'settings.excludeFoldersDesc': 'Folders to exclude from maintenance scan (comma-separated)',
  'settings.excludeFiles': 'Exclude File Patterns',
  'settings.excludeFilesDesc': 'File patterns to exclude from maintenance scan (comma-separated, glob supported)',
  'settings.excludeTags': 'Exclude Tags',
  'settings.excludeTagsDesc': 'Notes with these tags are excluded from maintenance scan (comma-separated)',
  'settings.archiveFolder': 'Archive Folder',
  'settings.archiveFolderDesc': 'Target folder for archived notes',

  'settings.privacy': 'Privacy',
  'settings.privacyDesc': 'Notes matching these rules will not be sent to AI.',
  'settings.ruleName': 'Rule name',
  'settings.ruleAdd': 'Add Rule',
  'settings.ruleDelete': 'Delete',
  'settings.ruleNumber': 'Rule {{number}}',
  'settings.ruleTypeFolderExclude': 'Folder exclude',
  'settings.ruleTypeTagExclude': 'Tag exclude',
  'settings.ruleTypeFrontmatterExclude': 'Frontmatter exclude',
  'settings.ruleTypeContentRedact': 'Content redact',
} as const;

export default en;
