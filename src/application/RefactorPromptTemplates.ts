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
    untaggedSystem: 'You are a tag taxonomy expert. Analyze untagged notes and suggest appropriate tags based on their content and context within the vault. Respond ONLY with valid JSON.',
    untaggedUser: (noteChunk: string, knownTags: string) =>
      `These notes have NO tags. Suggest appropriate tags for each based on their content.

Known tags in this vault (use these preferentially):
${knownTags}

Untagged notes:
${noteChunk}

Rules:
1. Prefer existing vault tags over inventing new ones
2. Suggest 1-3 tags per note
3. Tags must be relevant to the note's actual content
4. confidence reflects how well the tags match (0.0-1.0)
5. Use hierarchical tags (e.g., #dev/frontend) when appropriate

Return JSON:
{
  "suggestions": [
    { "notePath": "path/to/note.md", "tags": ["#tag1", "#tag2"], "confidence": 0.8, "rationale": "..." }
  ]
}`,
  },

  noteReorganize: {
    system: 'You are a vault organizer specializing in orphan note triage. Analyze disconnected and problematic notes, then suggest the best existing folder or archive destination. Respond ONLY with valid JSON.',
    user: (noteChunk: string, folders: string) =>
      `These notes are ORPHANS — they have zero incoming links (backlinks) and zero outgoing links. They are completely disconnected from the rest of the vault and need to be reorganized into proper permanent folders.

Existing folders:
${folders}

Orphan notes:
${noteChunk}

Rules:
1. You MUST return EXACTLY one result per note listed above. Do NOT skip any note.
2. These notes need to be MOVED to a proper permanent folder. Suggest the best semantic match from the existing folders list.
3. Analyze each note's content, title, and tags to find the most appropriate folder.
4. Notes about specific projects/topics should go to their relevant folder.
5. Very short or stub notes with no clear purpose → suggest "Archive".
6. If no existing folder fits, suggest a new descriptive folder path.
7. confidence should reflect how clearly the note belongs in the suggested folder (0.0-1.0).
8. Keep rationale under 15 words to save output space.

Return JSON array (one entry per note, in order by index number):
[
  { "index": 1, "suggestedFolder": "Projects", "confidence": 0.85, "rationale": "..." }
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
    brokenLinkSystem: 'You fix broken links in a knowledge vault. Given a broken link and search candidates, suggest the best replacement target. Respond ONLY with valid JSON.',
    brokenLinkUser: (brokenLinks: string, candidates: string) =>
      `These notes contain broken wiki-links (targets that do not exist in the vault). Suggest fixes.

Broken links:
${brokenLinks}

Available candidate notes found by search:
${candidates}

Rules:
1. For each broken link, suggest the most likely intended target from candidates
2. If no good match exists, suggest "remove" as the action
3. confidence reflects how likely the suggested fix is correct (0.0-1.0)

Return JSON:
{
  "fixes": [
    { "sourcePath": "note.md", "brokenLink": "[[non-existent]]", "suggestedTarget": "actual-note.md", "action": "replace", "confidence": 0.8, "rationale": "..." }
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

  misplacedDetect: {
    system: 'You are a vault organization expert. Analyze notes that may be in the wrong folder based on their content, tags, and link connections. For each misplaced note, suggest the correct folder AND relevant tags and links. Respond ONLY with valid JSON.',
    user: (noteChunk: string, folders: string, knownTags: string) =>
      `Analyze these notes and determine if they are misplaced. For each note, I provide its current folder, tags, links, and a content preview.

Notes:
${noteChunk}

Existing folders in the vault:
${folders}

Known tags in the vault:
${knownTags}

Rules:
1. A note is "misplaced" if its content/tags/links strongly suggest it belongs in a DIFFERENT existing folder
2. Only flag notes where you are confident (>= 0.6) they are misplaced
3. For each misplaced note, suggest the correct folder from the existing folder list (prefer existing folders over new ones)
4. Also suggest additional tags that fit the note's content and match the target folder's context
5. Suggest links to notes in the target folder that are topically related
6. Keep existing tags — only ADD missing ones
7. Do NOT suggest moving a note if it reasonably fits its current folder

Return JSON array:
[
  {
    "index": 1,
    "isMisplaced": true,
    "suggestedFolder": "Projects/WebDev",
    "suggestedTags": ["#webdev", "#frontend"],
    "suggestedLinks": ["Projects/WebDev/react-patterns.md"],
    "confidence": 0.8,
    "rationale": "Note discusses React hooks but is in Inbox..."
  }
]`,
  },

  folderOptimize: {
    splitSystem: 'You are a vault structure optimizer. Given a folder with many notes grouped by content similarity clusters, suggest meaningful sub-folder names. Respond ONLY with valid JSON.',
    splitUser: (folderName: string, clusters: string, existingSubfolders: string) =>
      `This folder "${folderName}" is too large. Notes have been pre-clustered by content similarity.

Clusters:
${clusters}

Existing sub-folders (for naming consistency):
${existingSubfolders}

Rules:
1. Suggest a descriptive sub-folder name for each cluster
2. Names should follow the naming style of existing folders
3. Names should be concise (1-3 words) and descriptive
4. Use existing sub-folder names if a cluster matches one

Return JSON:
{
  "splits": [
    { "clusterIndex": 0, "suggestedName": "web-development", "confidence": 0.85, "rationale": "..." }
  ]
}`,
    mergeSystem: 'You are a vault structure optimizer. Given small folders that may be candidates for merging, confirm or reject merge proposals. Respond ONLY with valid JSON.',
    mergeUser: (mergeCandidates: string) =>
      `These folder pairs have been identified as potential merge candidates based on tag overlap and content similarity.

Candidates:
${mergeCandidates}

Rules:
1. Only confirm a merge if the folders genuinely cover the same topic area
2. Suggest the best name for the merged folder (can be one of the existing names or a new one)
3. Reject merges where folders represent distinct sub-topics that benefit from separation

Return JSON:
{
  "merges": [
    { "pairIndex": 0, "shouldMerge": true, "suggestedName": "design-resources", "confidence": 0.75, "rationale": "..." }
  ]
}`,
  },

  fleetingPromote: {
    system: 'You are a knowledge vault curator. Identify mature notes that have outgrown their inbox/fleeting status and suggest a permanent folder. Respond ONLY with valid JSON.',
    user: (noteChunk: string, folders: string) =>
      `These notes are in inbox/fleeting folders but appear to have matured (high word count, tags, links, age). Suggest a permanent home folder for each.

Notes:
${noteChunk}

Existing folders in the vault:
${folders}

Rules:
1. Choose the best-fitting existing folder based on the note's content, tags, and links
2. Only suggest a new folder if no existing folder fits well (confidence threshold: 0.7 for existing, 0.6 for new)
3. Consider the note's tags and links to determine which folder's notes it relates to most
4. If a note is still genuinely fleeting (incomplete thought, no clear topic), skip it

Return JSON array:
[
  {
    "index": 1,
    "suggestedFolder": "Projects/WebDev",
    "isNewFolder": false,
    "confidence": 0.8,
    "rationale": "Note has grown into a full React tutorial with tags and links to other webdev notes..."
  }
]`,
  },
} as const;
