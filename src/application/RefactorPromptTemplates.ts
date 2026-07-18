export const REFACTOR_PROMPTS = {
  tagCleanup: {
    system: 'You are a tag taxonomy expert for a knowledge vault. Analyze tags and suggest merges for duplicates, near-duplicates, and cross-language variants. Respond ONLY with valid JSON.',
    user: (tagChunk: string, existingMappings: string) =>
      `Analyze these vault tags and identify groups that should be merged.

Tags (with usage count):
${tagChunk}

${existingMappings ? `Existing normalized mappings (for reference):\n${existingMappings}\n` : ''}
Rules:
1. Group tags that represent the same concept (e.g., #JS, #javascript, #자바스크립트 → #javascript)
2. The canonical tag should be the most commonly used variant
3. Cross-language duplicates should merge to the English form unless the vault is predominantly non-English
4. Do NOT merge tags that represent genuinely different concepts even if they look similar
5. Preserve hierarchical tags (e.g., #dev/frontend is different from #dev/backend)

Return JSON:
{
  "mergeGroups": [
    { "canonical": "#javascript", "variants": ["#JS", "#js", "#자바스크립트"], "confidence": 0.9, "rationale": "..." }
  ]
}`,
    synthesis: (chunkResults: string) =>
      `Multiple chunks of tags were analyzed. Synthesize the results and resolve conflicts.

Chunk results:
${chunkResults}

Rules:
1. If the same tag appears in different merge groups across chunks, pick the canonical with higher total usage
2. Remove self-referencing merges (canonical === variant)
3. Ensure no tag appears as both a canonical and a variant

Return JSON:
{
  "mergeGroups": [
    { "canonical": "#tag", "variants": ["#var1", "#var2"], "confidence": 0.9, "rationale": "..." }
  ],
  "missingTagSuggestions": [
    { "notePath": "path/to/note.md", "tags": ["#tag1", "#tag2"], "confidence": 0.8, "rationale": "..." }
  ]
}`,
  },

  noteReorganize: {
    system: 'You are a vault organizer. Analyze notes and suggest the best existing folder for each. Respond ONLY with valid JSON.',
    user: (noteChunk: string, folders: string) =>
      `Analyze these notes and suggest the best folder for each within the EXISTING folder structure.

Existing folders:
${folders}

Notes:
${noteChunk}

Rules:
1. ONLY suggest folders from the existing list above
2. If a note is already in its best folder, set suggestedFolder to its current folder
3. Consider the note's content, tags, and existing links to determine the best placement
4. confidence should reflect how well the note fits the suggested folder (0.0-1.0)
5. Be conservative — only suggest moves when clearly beneficial

Return JSON array:
[
  { "path": "note.md", "suggestedFolder": "Projects", "confidence": 0.85, "rationale": "..." }
]`,
    tier2System: 'You are a vault architect. Suggest new folder structures for notes that do not fit existing folders. Respond ONLY with valid JSON.',
    tier2User: (noteChunk: string, existingFolders: string) =>
      `These notes did not fit well into any existing folder. Suggest new folders to organize them.

Existing folders (do not remove, only add):
${existingFolders}

Notes needing new folders:
${noteChunk}

Rules:
1. Suggest the MINIMUM number of new folders needed
2. New folders should follow the vault's existing naming convention
3. Each new folder should have at least 2 notes assigned to it
4. Provide a clear semantic purpose for each new folder

Return JSON:
{
  "newFolders": [
    { "path": "NewFolder", "purpose": "...", "notes": ["path1.md", "path2.md"], "confidence": 0.8 }
  ]
}`,
    synthesis: (chunkResults: string, folderTree: string) =>
      `Synthesize folder reorganization results from multiple analysis chunks.

Existing folder tree:
${folderTree}

Chunk results:
${chunkResults}

Rules:
1. Resolve conflicts: if the same note was assigned different folders in different chunks, pick the higher confidence one
2. Verify no note is moved to a non-existent folder (must be in existing or newly proposed folders)
3. Group related moves together

Return JSON:
{
  "moves": [
    { "path": "note.md", "from": "OldFolder", "to": "NewFolder", "confidence": 0.85, "rationale": "...", "isNewFolder": false }
  ],
  "newFolders": ["NewFolder1"]
}`,
  },

  linkSuggest: {
    system: 'You resolve orphan notes by suggesting relevant wiki-links to connect them with the vault. Respond ONLY with valid JSON.',
    user: (orphanNote: string, candidates: string) =>
      `This note has NO links to or from any other note (orphan). Suggest connections.

Orphan note:
${orphanNote}

Candidate related notes found by search:
${candidates}

Rules:
1. Suggest links only to candidates that share meaningful topical overlap
2. Prefer bidirectional relevance (the candidate would also benefit from linking back)
3. Maximum 5 suggested links per orphan
4. confidence reflects how relevant the connection is (0.0-1.0)

Return JSON:
{
  "suggestedLinks": [
    { "targetPath": "candidate.md", "confidence": 0.8, "rationale": "..." }
  ]
}`,
  },

  fleetingConsolidate: {
    system: 'You consolidate multiple short fleeting notes into a single well-structured document. Respond ONLY with valid JSON.',
    user: (cluster: string) =>
      `These short notes (fleeting notes / quick captures) are semantically related. Merge them into one well-structured note.

Notes in cluster:
${cluster}

Rules:
1. Preserve ALL unique information from every note
2. Organize chronologically and by subtopic
3. Use clear headings to separate sections
4. The merged content should be valid Markdown without frontmatter
5. Add a source block at the end listing original note paths
6. Merge tags from all notes (deduplicate)

Return JSON:
{
  "mergedTitle": "Descriptive title for the merged note",
  "mergedContent": "full markdown content",
  "mergedTags": ["#tag1", "#tag2"],
  "confidence": 0.85,
  "rationale": "..."
}`,
  },
} as const;
