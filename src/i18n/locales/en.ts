const en = {
  // ─── Plugin ───
  'plugin.name': 'Vaultend',

  // ─── Commands ───
  'command.quickAsk': 'Quick Ask',

  'command.organizeNote': 'Organize Current Note',
  'command.runMaintenance': 'Run Maintenance',
  'command.organizeFolder': 'Organize Folder',
  'command.openLog': 'Open Maintenance Log',
  'command.scanFolder': 'Scan this folder for maintenance',

  // ─── Notices ───

  'notice.organizeResult': 'Folder: {{folder}} | Tags: {{tags}}',
  'notice.organizeFailed': 'Note organize failed: {{error}}',
  'notice.organizeAlreadyRunning': 'Folder organizing is already running.',
  'notice.dismissed': 'Issue dismissed',
  'notice.actionApplied': 'Action applied',
  'notice.noChangeNeeded': 'No changes to apply',
  'notice.actionFailed': 'Action failed: {{error}}',
  'notice.noSelection': 'No items selected',
  'notice.batchResult': '{{success}} applied, {{failed}} failed',
  'notice.batchComplete': '{{count}} applied',
  'notice.batchDismissed': '{{count}} dismissed',
  'notice.batchRestored': '{{count}} restored',
  'notice.batchRestoreResult': '{{success}} restored, {{failed}} failed',
  'notice.autoMaintenanceFound': 'Auto Maintenance: {{count}} issues found',

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
  'maintenance.restored': 'Restored',

  // Issue type labels
  'issue.emptyNotes': 'Empty Notes ({{count}})',
  'issue.untaggedNotes': 'Untagged Notes ({{count}})',
  'issue.missingTags': 'Missing Tags ({{count}})',
  'issue.brokenLinks': 'Broken Links ({{count}})',
  'issue.orphanNotes': 'Orphan Notes ({{count}})',
  'issue.duplicates': 'Duplicate Candidates ({{count}})',
  'issue.duplicateTags': 'Duplicate Tags ({{count}})',

  // Issue type short labels (for filter chips)
  'issueShort.empty': 'Empty',
  'issueShort.untagged': 'Untagged',
  'issueShort.missing-tags': 'Missing Tags',
  'issueShort.broken-link': 'Broken Links',
  'issueShort.orphan': 'Orphans',
  'issueShort.duplicate': 'Duplicates',
  'issueShort.duplicate-tags': 'Dup Tags',

  // Summary
  'summary.emptyNotes': 'empty {{count}}',
  'summary.untagged': 'untagged {{count}}',
  'summary.missingTags': 'missing tags {{count}}',
  'summary.brokenLinks': 'broken links {{count}}',
  'summary.orphanNotes': 'orphans {{count}}',
  'summary.duplicates': 'duplicates {{count}}',
  'summary.duplicateTags': 'duplicate tags {{count}}',

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
  'btn.mergeTags': 'Merge',
  'btn.ask': 'Ask',
  'btn.close': 'Close',

  // Batch
  'batch.selectAll': 'Select All',
  'batch.toggleAll': 'Select / Deselect All',
  'batch.selectedArchive': 'Archive Selected',
  'batch.selectedDelete': 'Delete Selected',
  'batch.selectedDismiss': 'Dismiss Selected',
  'batch.selectedRestore': 'Restore Selected',
  'batch.selectedRemoveLinks': 'Remove Selected Links',
  'batch.selectedApplyTags': 'Apply Tags to Selected',
  'batch.selectedMergeTags': 'Merge Selected',

  // Dismiss
  'dismiss.tooltip': 'Dismiss',

  // Impact warning
  'impact.warning': '⚠ Referenced by {{count}} notes: {{names}}{{suffix}}',
  'impact.andMore': ' and {{count}} more',

  // Duplicates
  'duplicate.tagSuggestion': '{{tags}} suggested',
  'duplicate.similarity': 'Similarity {{score}}%',
  'duplicateTag.keep': 'Keep: {{tag}}',
  'duplicateTag.variants': 'Variants: {{tags}}',
  'duplicateTag.affected': '{{count}} notes affected',

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

  // ─── Organize Folder Result View ───
  'organizeFolder.viewTitle': 'Organize Folder',
  'organizeFolder.scanning': 'Analyzing notes with AI...',
  'organizeFolder.scanFailed': 'Organizing failed: {{error}}',
  'organizeFolder.startScan': 'Start Organizing',
  'organizeFolder.selectFolder': 'Select a folder to organize',
  'organizeFolder.rescan': 'Re-organize',
  'organizeFolder.summary': '{{processed}} processed, {{skipped}} skipped, {{errors}} errors',
  'organizeFolder.noResults': 'No notes to organize in this folder.',
  'organizeFolder.lowConfidence': 'Low Confidence',
  'organizeFolder.category': 'Category: {{category}}',
  'organizeFolder.tagsSection': 'Tags',
  'organizeFolder.linksSection': 'Links',
  'organizeFolder.moveSection': 'Move to',
  'organizeFolder.applyNote': 'Apply',
  'organizeFolder.applySelected': 'Apply Selected',
  'organizeFolder.skipSelected': 'Skip Selected',
  'organizeFolder.undoNote': 'Undo',
  'organizeFolder.applied': 'Applied',
  'organizeFolder.skipped': 'Skipped',
  'organizeFolder.noChanges': 'No changes suggested',
  'organizeFolder.tokenTotal': 'Total tokens: {{count}} · Cost: ${{cost}}',
  'organizeFolder.tokenNote': '{{count}} tokens · ${{cost}}',

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
  'quickAsk.suggestedTags': 'Suggested Tags: {{tags}}',
  'quickAsk.references': 'Referenced Notes',
  'quickAsk.truncated': '⚠ Response was truncated. Increase Max Response Tokens in Settings for longer answers.',
  'quickAsk.sendButton': 'Send',
  'quickAsk.saveConversation': 'Save Conversation',
  'quickAsk.saved': 'Saved',
  'quickAsk.noResults': 'No related notes found in your vault. Try asking after creating relevant notes.',
  'quickAsk.turnLimit': 'Conversation length limit reached. Please start a new conversation.',
  'quickAsk.chatPlaceholder': 'Type a message... (Enter to send, Shift+Enter for newline)',

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
  'organize.tokens': 'Tokens: {{count}}',
  'organize.cost': 'Cost: ${{amount}}',

  // ─── Organize Folder ───
  'organizeFolder.placeholder': 'Select a folder to organize...',

  'organizeFolder.cancel': 'Cancel',

  // ─── Settings ───
  'settings.title': 'Vaultend Settings',

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
  'settings.modelDesc': 'Select the AI model to use.',
  'settings.modelCustom': 'Custom',

  'settings.organize': 'Organize',
  'settings.captureFolder': 'Organize Folder',
  'settings.captureFolderDesc': 'Default folder for Organize Folder command',
  'settings.autoApply': 'Auto Apply',
  'settings.autoApplyDesc': 'Automatically apply folder organizing results.',

  'settings.quickAsk': 'Quick Ask',
  'settings.saveMode': 'Save Mode',
  'settings.saveModeDesc': 'Choose how Quick Ask answers are saved.',
  'settings.saveModeTimestamp': 'Timestamp filename (separate file per question)',
  'settings.saveModeDailyNote': 'Daily Note (append to one file per day)',
  'settings.maxTokens': 'Max Response Tokens',
  'settings.maxTokensDesc': 'Maximum tokens for AI response (1024–16384). Higher values allow longer answers but cost more.',
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

  'settings.search': 'Search (Advanced)',
  'settings.rrfEmbeddingWeight': 'Embedding weight',
  'settings.rrfEmbeddingWeightDesc': 'Weight multiplier for embedding results in hybrid search (default: 4.0). Higher values favor semantic similarity over keyword match.',
  'settings.rrfK': 'RRF K parameter',
  'settings.rrfKDesc': 'Reciprocal Rank Fusion smoothing parameter (default: 20). Lower values make rank differences more dramatic.',

  // ─── Domain Errors ───
  'error.noteNotFound': 'Note not found: {{id}}',
  'error.duplicateNote': 'Note already exists: {{path}}',
  'error.invalidContent': 'Invalid note content: {{reason}}',
  'error.aiProvider': 'AI error [{{provider}}] ({{status}}): {{detail}}',
  'error.privacyViolation': 'Blocked by privacy rule: {{rule}}',
  'error.rateLimit': 'Rate limit exceeded — retry after {{ms}}ms',
  'error.historyNotFound': 'History entry not found: {{id}}',

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
