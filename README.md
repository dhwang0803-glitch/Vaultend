# Knowledge Maintenance — Obsidian Plugin

> Focus on writing. Let AI handle the organization.

An AI-powered knowledge maintenance engine for Obsidian. Automatically classify, tag, link, and maintain your vault — with full privacy control and undo safety.

![Obsidian](https://img.shields.io/badge/Obsidian-1.7.2+-purple)
![License](https://img.shields.io/badge/license-MIT-green)

<!-- TODO: Add hero screenshot showing the maintenance result view -->

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
  - [Quick Ask](#quick-ask)
  - [Note Organizer](#note-organizer)
  - [Inbox Processing](#inbox-processing)
  - [Vault Maintenance](#vault-maintenance)
  - [Activity Log](#activity-log)
  - [Clipboard Capture](#clipboard-capture)
  - [Privacy Protection](#privacy-protection)
- [Commands](#commands)
- [Settings](#settings)
- [Installation](#installation)
- [Internationalization](#internationalization)
- [Architecture](#architecture)
- [Compatibility](#compatibility)
- [Known Limitations](#known-limitations)
- [Development](#development)
- [License](#license)

---

## Quick Start

1. Install the plugin (see [Installation](#installation))
2. Go to **Settings → Knowledge Maintenance → AI Provider**
3. Select your provider (OpenAI or Google Gemini) and enter your API key
4. Open the Command Palette (`Ctrl/Cmd + P`) and try **Quick Ask**

That's it. The plugin is ready to organize your vault.

---

## Features

### Quick Ask

Ask AI questions using your vault as context — directly from the Command Palette.

<!-- TODO: screenshot of Quick Ask modal -->

**How to use**: `Ctrl/Cmd + P` → "Quick Ask" → type your question → `Ctrl+Enter` to send.

| Feature | Description |
|---------|-------------|
| Vault-aware context | Automatically searches relevant notes and includes them in the prompt |
| Save to file | Answers saved to timestamped files or Daily Notes (configurable) |
| Wikilink extraction | Detects `[[links]]` in responses for navigation |
| Token & cost display | Real-time usage info shown after each response |
| Markdown rendering | AI responses render with full Markdown formatting |
| Keyboard shortcut | `Ctrl+Enter` to send, `Escape` to close |

**Save modes**:
- **Timestamp** — each Q&A gets its own file in `QuickAsk/YYYY-MM-DD/`
- **Daily Note** — all Q&A for a day appended to one file (auto-splits when size limit is reached)

---

### Note Organizer

Analyze the active note with AI to get classification, tags, and link suggestions.

**How to use**: Open a note → `Ctrl/Cmd + P` → "Organize Current Note"

> This command only appears when a note is actively open in the editor.

The AI will:
1. Classify the note into a category (technology, personal, work, etc.)
2. Suggest relevant tags based on your vault's existing tag list
3. Propose links to related notes in your vault
4. Suggest a folder to move the note into

Results are shown as a Notice (`Category: X | Tags: Y`). This command **shows results only** — it does not modify your note. To auto-apply changes, use Inbox Processing instead.

---

### Inbox Processing

Automatically detect and process new notes landing in your Inbox folder. Internally runs the same AI classification as Note Organizer, but in batch mode with auto-apply.

<!-- TODO: screenshot of Inbox Status view -->

**How it works**:
1. Drop notes into your Inbox folder (default: `Inbox/`)
2. The plugin watches for new files (2-second debounce)
3. Each note gets sent to AI for classification
4. AI returns: category, suggested tags, and target folder
5. Tags are written to frontmatter, note is moved to the suggested folder

**How AI decides tags and folders**:
- **Tags**: AI reads the note content and references your vault's existing tag list (`knownTags` in settings) to suggest relevant tags. New tags may also be proposed based on content.
- **Folder**: AI classifies the note's category (technology, personal, work, etc.) and maps it to an appropriate folder path. The mapping is inferred from your vault's existing folder structure.

**Trigger methods**:
- **Automatic**: Runs on file creation/modification in the Inbox folder
- **Manual**: `Ctrl/Cmd + P` → "Process Inbox"
- **Startup catch-up**: Processes any unprocessed notes when Obsidian launches

**Auto Apply setting**: When enabled, tags and folder moves happen automatically. When disabled, only classification is performed and results are logged.

**Status view**: Open with "Open Inbox Status" command — shows total/processed/unprocessed counts.

---

### Vault Maintenance

Scan your vault for structural issues and fix them in bulk. **No AI required** — all detection is local analysis (link graph, file content, keyword matching).

<!-- TODO: screenshot of Maintenance Results view with severity badges and filter -->

**How to use**:
- **Full vault**: `Ctrl/Cmd + P` → "Run Maintenance"
- **Single folder**: Right-click a folder → "Scan this folder for maintenance"

#### Issue Types

| Type | Severity | Description |
|------|----------|-------------|
| Broken Links | Critical | `[[wikilinks]]` pointing to non-existent notes (heading/block fragment aware) |
| Empty Notes | Critical | Notes with no content (shows backlink impact) |
| Orphan Notes | Warning | Notes not linked from anywhere (canvas-aware) |
| Duplicates | Warning | Similar notes detected via Jaccard similarity (side-by-side view) |
| Untagged Notes | Info | Notes without any tags |
| Missing Tags | Info | AI-suggested tags for notes that need them |

#### Severity Badges & Sorting

Results are sorted by severity (**Critical → Warning → Info**) so you always see the most urgent issues first. Each section header shows a color-coded badge.

#### Filtering

Narrow down results in large vaults:

- **Severity chips** — toggle entire severity levels on/off
- **Type chips** — toggle individual issue types
- **Text search** — real-time path-based filtering (type a folder name or note title)

#### Actions

Each issue has contextual action buttons:

| Action | Available for | Effect |
|--------|--------------|--------|
| Open | All | Open the note in editor |
| Archive | Empty, Orphan | Move to archive folder |
| Delete | Empty, Orphan | Delete permanently (with undo) |
| Apply Tags | Missing Tags | Write suggested tags to frontmatter |
| Remove Link | Broken Links | Convert `[[broken]]` to plain text |
| Create Note | Broken Links | Create the missing target note |
| Open Side by Side | Duplicates | Compare two notes in split view |
| Dismiss | All | Hide from results (session-scoped) |

#### Batch Operations

Select multiple items and act on them at once:

1. Check the **Select All** checkbox at the top of a section (or check individual items)
2. Click an action button: **Archive Selected**, **Delete Selected**, **Dismiss Selected**, etc.

#### Undo / Redo

Made a mistake? Use the **Undo** (↶) and **Redo** (↷) buttons in the toolbar.

- Undo reverts the last dismiss action (items reappear)
- Redo re-applies the dismissed state
- Destructive actions (delete, archive) are recorded in the [Activity Log](#activity-log) with full content backup for restoration

#### Automatic Scheduling

Enable in Settings to run maintenance on a timer (default: every 60 minutes). The plugin runs in the background and only notifies you when issues are found.

---

### Activity Log

Track every action the plugin takes — and restore previous states.

<!-- TODO: screenshot of Activity Log with refresh button and restore -->

**How to open**: `Ctrl/Cmd + P` → "Open Maintenance Log"

**What gets recorded**:
- Note deletions (with previous content for restore)
- Note archival
- Tag additions
- Link removals
- Note creation (for broken link fixes)
- Issue dismissals
- Clipboard captures
- Quick Ask saves
- Note classifications
- **Restorations** (when you use the Restore button)

**Restore button**: Entries that modified or deleted content show a **Restore** button. Click it to revert the note to its state before the action. The restoration itself is also logged.

**Refresh**: Click the ↻ button to reload the latest entries without restarting Obsidian.

---

### Clipboard Capture

Save clipboard text as a new note instantly.

**How to use**: `Ctrl/Cmd + P` → "Capture Clipboard"

The clipboard content is saved as a new note in your Inbox folder with a timestamp filename. Useful for quickly saving web snippets, quotes, or ideas.

---

### Privacy Protection

Fine-grained control over what gets sent to AI. Configure rules in **Settings → Privacy**.

| Rule Type | What it does |
|-----------|-------------|
| Folder exclude | Notes in specified folders are never sent to AI |
| Tag exclude | Notes with specific tags are excluded from AI context |
| Frontmatter exclude | Notes with specific frontmatter keys are excluded |
| Content redact | Regex patterns are replaced with `[REDACTED]` before sending |

**Content redaction example**: Pattern `password:\S+` replaces `password:abc123` with `[REDACTED]` before sending. Your original note is never modified.

**Key guarantee**: Privacy rules run before ANY data leaves your device. AI never sees excluded or redacted content.

---

## Commands

All commands are accessible via `Ctrl/Cmd + P` (Command Palette).

| Command | Description | Requires AI |
|---------|-------------|:-----------:|
| Quick Ask | Ask AI with vault context | Yes |
| Organize Current Note | Classify and tag the active note | Yes |
| Process Inbox | Batch-process Inbox folder | Yes |
| Run Maintenance | Scan entire vault for issues | Partial |
| Scan this folder for maintenance | Right-click context menu | Partial |
| Capture Clipboard | Save clipboard as note | No |
| Open Maintenance Log | Show activity log sidebar | No |
| Open Inbox Status | Show Inbox status sidebar | No |

> "Partial" means orphan/broken-link/empty/duplicate detection works offline, but missing-tag suggestions require AI.

---

## Settings

Access via **Settings → Community Plugins → Knowledge Maintenance**.

### Language

| Setting | Description | Default |
|---------|-------------|---------|
| Display Language | en / ko / auto | Auto (follows Obsidian) |

### AI Provider

| Setting | Description | Default |
|---------|-------------|---------|
| AI Provider | OpenAI or Google Gemini | OpenAI |
| API Key | Your provider's API key | — |
| Model | Model name | gpt-4o |

> Changes apply immediately — no restart needed.

### Inbox

| Setting | Description | Default |
|---------|-------------|---------|
| Inbox Folder | Folder for unprocessed notes | Inbox |
| Auto Apply | Apply results automatically | Off |

### Quick Ask

| Setting | Description | Default |
|---------|-------------|---------|
| Save Mode | Timestamp (per-file) or Daily Note (append) | Timestamp |
| Daily Note Size Limit | Max KB before creating new file | 200 |

### Maintenance

| Setting | Description | Default |
|---------|-------------|---------|
| Auto Maintenance | Run on a timer | Off |
| Interval | Minutes between auto-scans | 60 |
| Exclude Folders | Comma-separated folder paths to skip | — |
| Exclude File Patterns | Glob patterns for files to skip | — |
| Exclude Tags | Notes with these tags are skipped | — |
| Archive Folder | Destination for archived notes | Archive |

### Privacy Rules

Add rules in the Privacy section. Each rule has:
- **Name** — descriptive label
- **Type** — Folder exclude / Tag exclude / Frontmatter exclude / Content redact
- **Pattern** — the folder path, tag, frontmatter key, or regex pattern

---

## Installation

### From Community Plugins (coming soon)

1. Open **Settings → Community Plugins → Browse**
2. Search "Knowledge Maintenance"
3. Click **Install**, then **Enable**
4. Configure your AI provider in Settings

### BRAT (Beta Testing)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. BRAT settings → **Add Beta Plugin**
3. Enter: `dhwang0803-glitch/Noluma`
4. Enable **Knowledge Maintenance** in Community Plugins
5. Configure AI provider and API key

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/dhwang0803-glitch/Noluma/releases)
2. Create `.obsidian/plugins/knowledge-maintenance/` in your vault
3. Copy the 3 files into that directory
4. Restart Obsidian → enable the plugin
5. Configure AI provider and API key

### Build from Source

```bash
git clone https://github.com/dhwang0803-glitch/Noluma.git
cd Noluma
npm install
npm run build
```

Copy `main.js`, `manifest.json`, `styles.css` to your vault's plugin directory.

### Mobile

The same 3 files go in `.obsidian/plugins/knowledge-maintenance/`.

- **With Obsidian Sync**: Install on desktop — it syncs automatically
- **Android**: `Internal Storage/Documents/Obsidian/[Vault]/.obsidian/plugins/knowledge-maintenance/`
- **iOS**: Files app → Obsidian → [Vault] → `.obsidian/plugins/knowledge-maintenance/`

---

## Internationalization

| Language | Status |
|----------|--------|
| English | Full support (default) |
| Korean (한국어) | Full support |

Change in **Settings → Language**. Views update immediately; command palette names update after restart.

Want to contribute a translation? See `src/i18n/locales/en.ts` for the key list.

---

## Architecture

Clean Architecture — dependencies always point inward toward the domain.

```
domain/          ← Pure business logic (zero external deps)
  models/        ← Note, MaintenanceAction, HistoryEntry
  values/        ← NotePath, TagName, Timestamp, Severity
  errors/        ← Domain-specific errors

application/     ← Use cases + port interfaces
  usecases/      ← QuickAsk, RunMaintenance, ApplyAction, etc.
  ports/         ← AIProviderPort, VaultAccessPort, HistoryPort, etc.

adapters/        ← Port implementations (external deps live here)
  ai/            ← OpenAI, Gemini, DynamicAI adapters
  vault/         ← ObsidianVaultAdapter
  history/       ← FileHistoryAdapter
  search/        ← JsonSearchIndexAdapter

ui/              ← Obsidian views, modals, settings tab
i18n/            ← Localization (en, ko)
main.ts          ← Composition Root
```

---

## Compatibility

| Platform | Minimum Version |
|----------|----------------|
| Obsidian | 1.7.2 |
| Desktop | Windows, macOS, Linux |
| Mobile | Android, iOS |

**AI Providers**: OpenAI API, Google Gemini API

---

## Known Limitations

| Area | Limitation |
|------|-----------|
| AI dependency | Quick Ask, Organizer, Inbox require an API key. Maintenance scan (orphans, broken links) works without AI. |
| API costs | All AI calls consume tokens. Monitor usage in Quick Ask's token display. |
| Network | AI features need internet. Maintenance scans work offline. |
| Search index | JSON keyword-based. Very large vaults (1000+ notes) may be slower. No semantic search. |
| Duplicates | Jaccard similarity — may miss semantically similar but differently worded notes. |
| Mobile | Background switching may interrupt AI calls. Clipboard subject to OS permissions. |
| Privacy | Rules control this plugin only. Review your AI provider's data policies separately. |

---

## Development

```bash
npm run dev        # Watch mode
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest (228 tests)
npm run test:watch # Watch mode tests
```

---

## License

[MIT](LICENSE)
