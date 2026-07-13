import type { Note } from '../domain/models/Note';
import type { NoteMetadata } from '../domain/models/NoteMetadata';
import type { NoteChunk } from '../domain/models/NoteChunk';
import type { PluginSettings } from '../application/ports/ConfigPort';
import type { NotePath } from '../domain/values/NotePath';
import type { NoteId } from '../domain/values/NoteId';
import type { NoteTitle } from '../domain/values/NoteTitle';
import type { TagName } from '../domain/values/TagName';
import type { Timestamp } from '../domain/values/Timestamp';
import type { ChunkText } from '../domain/values/ChunkText';
import type { HeadingPath } from '../domain/values/HeadingPath';

export function createTestNote(overrides?: Partial<Note>): Note {
  return {
    id: 'note-1' as unknown as NoteId,
    path: 'folder/test-note.md' as unknown as NotePath,
    title: 'Test Note' as unknown as NoteTitle,
    content: '# Test Note\n\nSome content here.',
    metadata: createTestMetadata(),
    chunks: [createTestChunk()],
    ...overrides,
  };
}

export function createTestMetadata(overrides?: Partial<NoteMetadata>): NoteMetadata {
  return {
    tags: [] as unknown as ReadonlyArray<TagName>,
    aliases: [],
    links: [] as unknown as ReadonlyArray<NotePath>,
    backlinks: [] as unknown as ReadonlyArray<NotePath>,
    frontmatterKeys: [],
    fileSize: 1024,
    createdAt: 1720000000000 as unknown as Timestamp,
    modifiedAt: 1720000000000 as unknown as Timestamp,
    isInbox: false,
    isProcessed: false,
    ...overrides,
  };
}

export function createTestChunk(overrides?: Partial<NoteChunk>): NoteChunk {
  return {
    headingPath: 'Test Note' as unknown as HeadingPath,
    text: 'Some content here.' as unknown as ChunkText,
    startLine: 0,
    endLine: 2,
    ...overrides,
  };
}

export function createDefaultSettings(overrides?: Partial<PluginSettings>): PluginSettings {
  return {
    aiProvider: 'openai',
    aiApiKey: '',
    aiModel: 'gpt-4o-mini',
    aiMaxTokens: 4096,
    aiTemperature: 0.7,
    inboxFolder: 'Inbox',
    autoApplyInbox: false,
    defaultSaveFolder: 'QuickAsk',
    defaultSaveTarget: 'new-note',
    maxContextChunks: 5,
    dailyNoteFormat: 'YYYY-MM-DD',
    dailyNoteFolder: 'Daily',
    maintenanceEnabled: true,
    maintenanceIntervalMinutes: 60,
    maintenanceExcludeFiles: [],
    maintenanceExcludeTags: [],
    maintenanceArchiveFolder: 'Archive',
    privacyRules: [],
    knownTags: [] as unknown as ReadonlyArray<TagName>,
    trackTokenUsage: false,
    embeddingsEnabled: false,
    embeddingsModel: 'text-embedding-3-small',
    rrfEmbeddingWeight: 4.0,
    rrfK: 20,
    ...overrides,
  };
}
