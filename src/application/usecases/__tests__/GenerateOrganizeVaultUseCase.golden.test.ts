import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { GenerateOrganizeVaultUseCase } from '../GenerateOrganizeVaultUseCase';
import { RunMaintenanceUseCase } from '../RunMaintenanceUseCase';
import type { AIProviderPort, CompletionRequest, CompletionResponse, ClassificationResponse, EmbeddingRequest, EmbeddingResponse } from '../../ports/AIProviderPort';
import type { VaultAccessPort } from '../../ports/VaultAccessPort';
import type { SearchIndexPort, SearchResult } from '../../ports/SearchIndexPort';
import type { OrganizeVaultPort } from '../../ports/OrganizeVaultPort';
import type { ConfigPort, PluginSettings } from '../../ports/ConfigPort';
import type { ClockPort } from '../../ports/ClockPort';
import type { MaintenancePlan, DuplicateTagGroup } from '../../../domain/models/OrganizeModels';
import type { Note } from '../../../domain/models/Note';
import { createNotePath, NotePath } from '../../../domain/values/NotePath';

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------

interface FolderResult { fixture: string; expected: readonly string[]; actual: string; correct: boolean }
interface TagResult { fixture: string; expected: readonly string[]; actual: readonly string[]; hits: readonly string[]; missed: readonly string[]; extra: readonly string[] }
interface LinkResult { fixture: string; brokenLink: string; expectedTarget: readonly string[]; actual: string; resolved: boolean; correctTarget: boolean }
interface TagRejectionResult { fixture: string; wrongTag: string; rejected: boolean; aiSuggested: readonly string[] }
interface DupTagResult { groupName: string; method: 'normalization' | 'embedding'; expectedTags: readonly string[]; found: boolean; actualGroup: readonly string[] }
interface FalsePositiveResult { tagA: string; tagB: string; correctlySeparated: boolean }

const folderResults: FolderResult[] = [];
const tagResults: TagResult[] = [];
const linkResults: LinkResult[] = [];
const tagRejectionResults: TagRejectionResult[] = [];
const dupTagResults: DupTagResult[] = [];
const falsePositiveResults: FalsePositiveResult[] = [];

function normTag(t: string): string { return t.toLowerCase().replace(/^#/, '').trim(); }
function parseTags(tagStr: string): string[] { return tagStr.split(/,\s*/).map(normTag).filter(t => t.length > 0); }

// ---------------------------------------------------------------------------
// Gemini adapter (fetch-based, no Obsidian dependency)
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RUN = !!GEMINI_API_KEY;

class GeminiFetchAdapter implements AIProviderPort {
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  constructor(private readonly apiKey: string, private readonly model = 'gemini-2.5-flash') {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      contents: [{ parts: [{ text: request.prompt }] }],
      generationConfig: {
        maxOutputTokens: request.maxTokens, temperature: request.temperature,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
    };
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
    const result = await response.json() as any;
    return {
      content: result.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      tokenUsage: { promptTokens: result.usageMetadata?.promptTokenCount ?? 0, completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0, totalTokens: result.usageMetadata?.totalTokenCount ?? 0, estimatedCostUsd: 0 },
      finishReason: 'stop',
    };
  }

  async callClassification(): Promise<ClassificationResponse> { throw new Error('unused'); }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? 'gemini-embedding-001';
    const requests = request.texts.map(text => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }));
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:batchEmbedContents?key=${this.apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
    if (!response.ok) throw new Error(`Gemini Embedding ${response.status}: ${await response.text()}`);
    const result = await response.json() as { embeddings: Array<{ values: number[] }> };
    const embeddings = result.embeddings.map((e: { values: number[] }) => new Float32Array(e.values));
    return {
      embeddings,
      dimension: embeddings[0]?.length ?? 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const SYNONYMS: Record<string, string[]> = {
  travel: ['trip', 'vacation', 'journey', 'itinerary'],
  trip: ['travel', 'vacation', 'journey'],
  guide: ['tutorial', 'intro', 'introduction', 'basics', 'handbook'],
  tutorial: ['guide', 'intro', 'howto'],
  basics: ['intro', 'introduction', 'guide', 'fundamental'],
  plan: ['planning', 'strategy', 'budget', 'roadmap'],
  paper: ['research', 'study', 'survey', 'article'],
  comparison: ['versus', 'compare', 'review'],
};

function note(path: string, content: string, tags: string[] = []): [string, Note] {
  return [path, {
    id: path as any, path: createNotePath(path),
    title: path.split('/').pop()?.replace('.md', '') as any, content,
    metadata: {
      tags: tags as any, aliases: [], links: [], backlinks: [],
      frontmatterKeys: tags.length > 0 ? ['tags'] : [],
      createdAt: Date.now() as any, modifiedAt: Date.now() as any,
      fileSize: content.length, isProcessed: false,
    },
    chunks: [],
  }];
}

function buildPorts(notes: Map<string, Note>, tagOverrides?: ReadonlyArray<{ tag: string; count: number }>) {
  const saved: any[] = [];
  const vault: VaultAccessPort = {
    readNote: vi.fn(async (p: NotePath) => notes.get(p as string) ?? null),
    listNotes: vi.fn(async () => [...notes.keys()].map(createNotePath)),
    writeNote: vi.fn(), moveNote: vi.fn(), deleteNote: vi.fn(), createNote: vi.fn(),
    updateFrontmatter: vi.fn(), readFileRaw: vi.fn(async () => null), writeFileRaw: vi.fn(),
    listFiles: vi.fn(async () => []), watchEvents: vi.fn(() => () => {}),
    exists: vi.fn(async (p: NotePath) => notes.has(p as string)),
    listAllTags: vi.fn(async () => {
      if (tagOverrides) return tagOverrides;
      const tagCount = new Map<string, number>();
      for (const n of notes.values()) {
        for (const t of (n.metadata.tags as string[])) {
          tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
        }
      }
      return [...tagCount.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
    }),
  } as unknown as VaultAccessPort;

  const searchIndex: SearchIndexPort = {
    search: vi.fn(async (query: string, limit: number): Promise<SearchResult[]> => {
      const queryWords = query.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 1);
      const results: { path: string; n: Note; score: number }[] = [];
      for (const [path, n] of notes) {
        const name = path.split('/').pop()?.replace('.md', '') ?? '';
        const nameWords = name.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 1);
        const titleLine = n.content.split('\n')[0]?.replace(/^#+\s*/, '').toLowerCase() ?? '';
        const titleWords = titleLine.split(/[\s\-_]+/).filter(w => w.length > 1);
        const allWords = new Set([...nameWords, ...titleWords]);
        const covered = queryWords.filter(qw => {
          const candidates = [qw, ...(SYNONYMS[qw] ?? [])];
          return candidates.some(c => [...allWords].some(w => w.startsWith(c) || c.startsWith(w)));
        });
        if (covered.length > 0) results.push({ path, n, score: covered.length / queryWords.length });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit).map(r => ({
        notePath: createNotePath(r.path), chunk: { content: r.n.content.substring(0, 200), startLine: 0, endLine: 5 } as any, score: r.score,
      }));
    }),
    index: vi.fn(), remove: vi.fn(), rebuild: vi.fn(),
  };

  const store: OrganizeVaultPort = {
    save: vi.fn(async (p: any) => { saved.push(p); }), load: vi.fn(async () => null),
    list: vi.fn(async () => []), delete: vi.fn(), updateProposalStatus: vi.fn(async () => null), updateStatus: vi.fn(async () => null),
  };

  const defaultSettings: PluginSettings = {
    aiProvider: 'gemini', aiApiKey: GEMINI_API_KEY!, aiModel: 'gemini-2.5-flash',
    aiMaxTokens: 8192, aiTemperature: 0.7,
    ollamaBaseUrl: '', deepseekApiKey: '', deepseekModel: '',
    customBaseUrl: '', customApiKey: '', customModel: '',
    captureFolder: 'Inbox', autoApplyOrganize: false,
    defaultSaveFolder: 'Vaultend', defaultSaveTarget: 'new-note',
    dailyNoteSizeLimitKB: 200,
    maxContextChunks: 5, dailyNoteFormat: 'YYYY-MM-DD', dailyNoteFolder: 'DailyNotes',
    maintenanceEnabled: false, maintenanceIntervalMinutes: 60, smartScheduling: false,
    maintenanceExcludeFolders: [], maintenanceExcludeFiles: [], maintenanceExcludeTags: [],
    maintenanceArchiveFolder: 'Archive', organizeConfidenceThreshold: 0,
    embeddingsEnabled: false, embeddingsModel: '', rrfEmbeddingWeight: 4.0, rrfK: 20,
    privacyRules: [],
    knownTags: ['#recipe', '#journal', '#project', '#meeting', '#reference', '#tutorial', '#research', '#health', '#finance', '#travel', '#book', '#idea', '#todo'],
    trackTokenUsage: true, locale: 'en', licenseKey: '', proGraceDeadline: 0,
  };

  const config: ConfigPort = {
    getSettings: vi.fn(async (): Promise<PluginSettings> => defaultSettings),
    saveSettings: vi.fn(), updateSettings: vi.fn(),
  };

  const clock: ClockPort = { now: () => Date.now() as any };
  return { vault, searchIndex, store, config, clock, saved };
}

// ---------------------------------------------------------------------------
// Vault base notes (25 notes across 13 folders)
// ---------------------------------------------------------------------------

function vaultNotes(): Map<string, Note> {
  return new Map([
    note('Recipes/pasta.md', '# Pasta Aglio e Olio\nClassic Italian pasta with garlic and olive oil.', ['#recipe']),
    note('Recipes/salad.md', '# Caesar Salad\nRomaine lettuce, croutons, parmesan, caesar dressing.', ['#recipe']),
    note('Recipes/smoothie.md', '# Green Smoothie\nSpinach, banana, almond milk, chia seeds. Blend until smooth.', ['#recipe']),
    note('Meetings/standup.md', '# Daily Standup Template\nWhat did you do? What will you do? Blockers?', ['#meeting']),
    note('Meetings/quarterly.md', '# Q2 2025 Quarterly Review\nRevenue growth, team expansion, roadmap.', ['#meeting']),
    note('Meetings/onboarding.md', '# New Hire Onboarding Checklist\nAccounts setup, intro meetings, codebase walkthrough.', ['#meeting']),
    note('Projects/website.md', '# Website Redesign\nMigrate from WordPress to Next.js. Timeline: 8 weeks.', ['#project']),
    note('Projects/mobile-app.md', '# Mobile App MVP\nFlutter-based cross-platform app for task management.', ['#project']),
    note('Projects/data-pipeline.md', '# Data Pipeline Refactor\nMigrate from Airflow to Dagster. ETL optimization.', ['#project']),
    note('Journal/2025-01-15.md', '# January 15, 2025\nGood day. Finished the API integration. Went for a walk.', ['#journal']),
    note('Journal/2025-03-20.md', '# March 20, 2025\nStressful week. Deadline approaching. Need to prioritize.', ['#journal']),
    note('Research/ml-transformers.md', '# Transformer Architecture\nSelf-attention mechanism. Encoder-decoder. GPT, BERT variants.', ['#research']),
    note('Research/vector-databases.md', '# Vector Database Comparison\nPinecone vs Weaviate vs Qdrant. Embedding storage and ANN search.', ['#research']),
    note('Tutorials/git-basics.md', '# Git Basics Tutorial\ngit init, add, commit, branch, merge. Step by step guide.', ['#tutorial']),
    note('Tutorials/docker-intro.md', '# Docker for Beginners\nContainers, images, Dockerfile, docker-compose. Hands-on examples.', ['#tutorial']),
    note('Reference/keyboard-shortcuts.md', '# VS Code Shortcuts\nCtrl+P: Quick Open. Ctrl+Shift+P: Command Palette.', ['#reference']),
    note('Reference/regex-cheatsheet.md', '# Regex Cheatsheet\n\\d digit, \\w word, .* any, ^ start, $ end. Common patterns.', ['#reference']),
    note('Finance/budget-2025.md', '# 2025 Budget Plan\nMonthly income, expenses, savings targets, investment allocation.', ['#finance']),
    note('Finance/tax-notes.md', '# Tax Filing Notes 2024\nDeductions, receipts, estimated payments. Due April 15.', ['#finance']),
    note('Health/workout-routine.md', '# Weekly Workout Routine\nMon: Chest/Tri. Tue: Back/Bi. Wed: Rest. Thu: Legs.', ['#health']),
    note('Health/meal-prep.md', '# Weekly Meal Prep Guide\nSunday: prep proteins, chop vegetables, cook grains.', ['#health']),
    note('Travel/japan-2025.md', '# Japan Trip 2025\nTokyo → Kyoto → Osaka. 10 days. Cherry blossom season.', ['#travel']),
    note('Travel/packing-list.md', '# Universal Packing List\nPassport, chargers, medications, toiletries, clothes.', ['#travel']),
    note('Books/atomic-habits.md', '# Atomic Habits — James Clear\nHabit stacking, 1% improvement, cue-craving-response-reward.', ['#book']),
    note('Ideas/app-ideas.md', '# App Ideas\nPomodoro with AI suggestions, habit tracker with streaks.', ['#idea']),
  ]);
}

// ===========================================================================
// A. Orphan Note Reposition — 15 fixtures
// ===========================================================================

interface OrphanFixture {
  name: string; path: string; content: string;
  acceptableFolders: readonly string[];
  expectedTags: readonly string[];
}

const ORPHAN_FIXTURES: readonly OrphanFixture[] = [
  { name: 'Korean BBQ recipe', path: 'Inbox/korean-bbq.md',
    content: '# Korean BBQ Marinade\n\n## Ingredients\n- 500g beef, thinly sliced\n- 4 tbsp soy sauce\n- 2 tbsp sesame oil\n- 3 tbsp brown sugar\n- 4 cloves garlic, minced\n- 1 Asian pear, grated\n- 1 tbsp gochujang\n\n## Instructions\n1. Mix all marinade ingredients\n2. Marinate beef for at least 2 hours\n3. Grill on high heat 2-3 min per side',
    acceptableFolders: ['Recipes'], expectedTags: ['recipe'] },
  { name: 'Sprint retrospective', path: 'Inbox/sprint-retro.md',
    content: '# Sprint 23 Retrospective — March 2025\n\n**Date**: March 28, 2025\n**Attendees**: Sarah, Mike, Jenna, Tom\n\n## What went well\n- Deployed payment integration on time\n- Code review turnaround < 24h\n\n## What didn\'t go well\n- Scope creep on dashboard\n\n## Action Items\n- [ ] Sarah: feature flags by April 5\n- [ ] Mike: fix flaky tests',
    acceptableFolders: ['Meetings', 'Projects'], expectedTags: ['meeting', 'project'] },
  { name: 'Python async tutorial', path: 'Inbox/python-async.md',
    content: '# Understanding Python Async/Await\n\n## Prerequisites\n- Python 3.7+\n\n## What is Async?\nAsynchronous programming lets your program do other work while waiting for I/O.\n\n```python\nimport asyncio\nasync def fetch_data(url):\n    await asyncio.sleep(1)\n    return {"data": "result"}\nasyncio.run(fetch_data("https://api.example.com"))\n```\n\n## Key Concepts\n1. async def defines a coroutine\n2. await pauses execution',
    acceptableFolders: ['Tutorials', 'Reference'], expectedTags: ['tutorial'] },
  { name: 'Personal journal entry', path: 'Inbox/quiet-sunday.md',
    content: '# A Quiet Sunday\n\nWoke up late, around 10am. Made coffee on the balcony.\nFinished "Atomic Habits" — habit stacking chapter resonated.\nWalked to the park with Luna. Cherry blossoms are blooming.\nFeeling grateful for slow, peaceful days.\nSimple dinner — rice and miso soup.',
    acceptableFolders: ['Journal', 'DailyNotes'], expectedTags: ['journal'] },
  { name: 'RAG survey paper', path: 'Inbox/rag-survey.md',
    content: '# RAG: Retrieval-Augmented Generation Survey\n\n## Overview\nRAG combines retrieval with generation. Lewis et al. (2020).\n\n## Architecture\n1. Retriever: DPR or BM25\n2. Generator: seq2seq (BART, T5)\n3. Index: FAISS ANN\n\n## Key Findings\n- Outperforms pure generative on knowledge tasks\n- Hybrid retrieval best\n\n## References\n- Lewis et al. (2020)',
    acceptableFolders: ['Research', 'Reference'], expectedTags: ['research', 'reference'] },
  { name: 'Monthly expense report', path: 'Inbox/march-expenses.md',
    content: '# March 2025 Expense Report\n\n## Income\n- Salary: $5,200\n- Freelance: $800\n\n## Expenses\n| Category | Amount |\n|----------|--------|\n| Rent | $1,500 |\n| Groceries | $420 |\n| Dining out | $230 |\n\n## Savings\n- Emergency fund: +$1,000\n- Investment: +$800',
    acceptableFolders: ['Finance'], expectedTags: ['finance'] },
  { name: 'Workout log', path: 'Inbox/leg-day.md',
    content: '# Leg Day — March 25, 2025\n\n| Exercise | Sets x Reps | Weight |\n|----------|------------|--------|\n| Barbell Squat | 4x8 | 135 lbs |\n| Romanian Deadlift | 3x10 | 115 lbs |\n| Leg Press | 3x12 | 270 lbs |\n| Calf Raises | 4x15 | 90 lbs |\n\n## Notes\n- Squat felt heavy, might deload next week\n- Good mind-muscle connection on RDLs',
    acceptableFolders: ['Health'], expectedTags: ['health', 'journal'] },
  { name: 'Cooking journal (ambiguous)', path: 'Inbox/sunday-cooking.md',
    content: '# Sunday Cooking Session\n\nGreat time in the kitchen today. Tried making grandma\'s apple pie — crust didn\'t turn out perfect, too much water.\nAlso made chicken soup for the week. Simple comfort food.\nFeeling nostalgic. Might call grandma tomorrow.',
    acceptableFolders: ['Journal', 'Recipes', 'DailyNotes'], expectedTags: ['journal'] },
  { name: 'Docker cheatsheet', path: 'Inbox/docker-commands.md',
    content: '# Docker Quick Reference\n\n## Common Commands\n```bash\ndocker build -t myapp .\ndocker run -d -p 8080:80 myapp\ndocker ps -a\ndocker logs <container>\ndocker exec -it <container> bash\ndocker-compose up -d\ndocker system prune -a\n```\n\n## Dockerfile Best Practices\n- Use multi-stage builds\n- Minimize layers\n- Use .dockerignore',
    acceptableFolders: ['Reference', 'Tutorials'], expectedTags: ['reference'] },
  { name: 'Book review', path: 'Inbox/deep-work-review.md',
    content: '# Deep Work — Cal Newport\n\n## Key Ideas\n- Deep work = professional activities in a state of distraction-free concentration\n- Shallow work = noncognitively demanding, logistical-style tasks\n- The ability to do deep work is becoming rare and valuable\n\n## Strategies\n1. Monastic: eliminate all distractions\n2. Bimodal: dedicate blocks to deep work\n3. Rhythmic: daily habits\n4. Journalistic: fit it where you can\n\n## My Takeaways\n- Schedule deep work blocks 9-12am\n- No phone in the morning',
    acceptableFolders: ['Books', 'Reference'], expectedTags: ['book'] },
  { name: 'Italy trip itinerary', path: 'Inbox/italy-2025.md',
    content: '# Italy Trip — September 2025\n\n## Itinerary\n- Day 1-3: Rome (Colosseum, Vatican, Trastevere)\n- Day 4-5: Florence (Uffizi, Ponte Vecchio, Tuscan hills)\n- Day 6-7: Venice (Grand Canal, Murano, gondola ride)\n\n## Flights\n- Departure: Sept 10, JFK → FCO\n- Return: Sept 17, VCE → JFK\n\n## Budget\n- Flights: $800\n- Hotels: $1,200\n- Food & Activities: $600',
    acceptableFolders: ['Travel'], expectedTags: ['travel'] },
  { name: 'Startup idea brainstorm', path: 'Inbox/saas-idea.md',
    content: '# SaaS Idea: AI Meeting Summarizer\n\n## Problem\nPeople waste 30min/day summarizing meetings manually.\n\n## Solution\nAuto-record → transcribe → extract action items → send summary to Slack.\n\n## Target Market\n- Remote-first teams (10-50 people)\n- $15/user/month\n\n## MVP Features\n1. Zoom/Meet integration\n2. Auto-transcription\n3. Action item extraction\n4. Slack notification\n\n## Competition\n- Otter.ai, Fireflies.ai — but no action item focus',
    acceptableFolders: ['Ideas', 'Projects'], expectedTags: ['idea', 'project'] },
  { name: 'Tax preparation checklist', path: 'Inbox/tax-prep-2025.md',
    content: '# Tax Preparation 2025\n\n## Documents Needed\n- [ ] W-2 from employer\n- [ ] 1099s (freelance income)\n- [ ] Mortgage interest (1098)\n- [ ] Charitable donations receipts\n- [ ] Medical expenses over $500\n\n## Deductions to Check\n- Home office (dedicated room)\n- Professional development courses\n- Software subscriptions for freelance\n\n## Deadlines\n- April 15: Filing deadline\n- Estimated payments: quarterly',
    acceptableFolders: ['Finance'], expectedTags: ['finance', 'todo'] },
  { name: 'Morning routine design', path: 'Inbox/morning-routine.md',
    content: '# Ideal Morning Routine\n\n6:00 — Wake up, no snooze\n6:05 — 10 min meditation (Headspace)\n6:15 — Cold shower\n6:30 — Journal: 3 gratitudes + daily intention\n6:45 — Coffee + read 20 pages\n7:15 — 30 min exercise (run or gym)\n7:45 — Healthy breakfast\n8:15 — Deep work block starts\n\n## Why This Order?\n- Meditation before stimulation\n- Exercise for energy before desk work\n- No phone until after breakfast',
    acceptableFolders: ['Health', 'Journal', 'Ideas'], expectedTags: ['health'] },
  { name: 'API design notes', path: 'Inbox/rest-api-design.md',
    content: '# REST API Design Principles\n\n## URL Structure\n- Use nouns, not verbs: `/users`, not `/getUsers`\n- Plural resources: `/users/123`\n- Nested for relationships: `/users/123/orders`\n\n## HTTP Methods\n- GET: read\n- POST: create\n- PUT: full update\n- PATCH: partial update\n- DELETE: remove\n\n## Status Codes\n- 200 OK, 201 Created, 204 No Content\n- 400 Bad Request, 401 Unauthorized, 404 Not Found\n- 500 Internal Server Error\n\n## Best Practices\n- Pagination: `?page=1&limit=20`\n- Versioning: `/v1/users`',
    acceptableFolders: ['Reference', 'Tutorials'], expectedTags: ['reference', 'tutorial'] },
];

// ===========================================================================
// B. Broken Link Inference — 8 fixtures
// ===========================================================================

interface BrokenLinkFixture {
  name: string; sourcePath: string; targetLink: string; lineNumber: number;
  extraNotes: [string, Note][];
  expectedTargetKeywords: readonly string[];
}

const BROKEN_LINK_FIXTURES: readonly BrokenLinkFixture[] = [
  { name: '"pasta recipe" → pasta.md', sourcePath: 'Notes/dinner-plan.md', targetLink: 'pasta recipe', lineNumber: 5,
    extraNotes: [note('Notes/dinner-plan.md', '# Dinner Plan\nTonight: [[pasta recipe]] with salad.')],
    expectedTargetKeywords: ['pasta'] },
  { name: '"git tutorial" → git-basics.md', sourcePath: 'Notes/learning-path.md', targetLink: 'git tutorial', lineNumber: 3,
    extraNotes: [note('Notes/learning-path.md', '# My Learning Path\nStart with [[git tutorial]] then React.')],
    expectedTargetKeywords: ['git-basics', 'git'] },
  { name: '"transformer paper" → ml-transformers.md', sourcePath: 'Notes/study-plan.md', targetLink: 'transformer paper', lineNumber: 7,
    extraNotes: [note('Notes/study-plan.md', '# Study Plan\nReview [[transformer paper]] before reading group.')],
    expectedTargetKeywords: ['ml-transformers', 'transformer'] },
  { name: '"budget plan" → budget-2025.md', sourcePath: 'Notes/annual-review.md', targetLink: 'budget plan', lineNumber: 2,
    extraNotes: [
      note('Notes/annual-review.md', '# Annual Review\nCheck [[budget plan]] for savings.'),
      note('Inbox/old-budget.md', '# Old Budget Notes\nDraft from last year.'),
    ],
    expectedTargetKeywords: ['budget-2025', 'budget'] },
  { name: '"docker guide" → docker-intro.md', sourcePath: 'Notes/devops-learning.md', targetLink: 'docker guide', lineNumber: 4,
    extraNotes: [note('Notes/devops-learning.md', '# DevOps Learning\nStart with [[docker guide]] then Kubernetes.')],
    expectedTargetKeywords: ['docker-intro', 'docker'] },
  { name: '"green smoothie recipe" → smoothie.md', sourcePath: 'Notes/healthy-eating.md', targetLink: 'green smoothie recipe', lineNumber: 6,
    extraNotes: [note('Notes/healthy-eating.md', '# Healthy Eating\nMorning: [[green smoothie recipe]]. Lunch: salad.')],
    expectedTargetKeywords: ['smoothie', 'green'] },
  { name: '"Japan travel plan" → japan-2025.md', sourcePath: 'Notes/vacation-ideas.md', targetLink: 'Japan travel plan', lineNumber: 3,
    extraNotes: [note('Notes/vacation-ideas.md', '# Vacation Ideas\nTop pick: [[Japan travel plan]] in spring.')],
    expectedTargetKeywords: ['japan', 'japan-2025'] },
  { name: '"vector db comparison" → vector-databases.md', sourcePath: 'Notes/tech-stack.md', targetLink: 'vector db comparison', lineNumber: 8,
    extraNotes: [note('Notes/tech-stack.md', '# Tech Stack\nFor embeddings: [[vector db comparison]] to choose provider.')],
    expectedTargetKeywords: ['vector-databases', 'vector'] },
];

// ===========================================================================
// C. Missing Tag Validation — 8 fixtures
// ===========================================================================

interface MissingTagFixture {
  name: string; path: string; content: string;
  ruleSuggestedTags: string[]; reason: string;
  expectedTags: readonly string[];
  wrongTags?: readonly string[];
}

const MISSING_TAG_FIXTURES: readonly MissingTagFixture[] = [
  { name: 'Banana bread → #recipe 확인', path: 'Notes/banana-bread.md',
    content: '# Banana Bread Recipe\nMix 3 ripe bananas, 1/3 cup melted butter, 3/4 cup sugar, 1 egg.\nAdd 1 tsp baking soda, pinch of salt, 1.5 cups flour. Bake at 350°F for 60 min.',
    ruleSuggestedTags: ['#recipe'], reason: 'Contains cooking keywords', expectedTags: ['recipe'] },
  { name: 'Paris trip → #meeting 거부', path: 'Notes/paris-trip.md',
    content: '# Paris Trip Planning\nFlights: March 15-22. Hotel near Eiffel Tower.\nDay 1: Louvre. Day 2: Montmartre. Day 3: Versailles.\nMust try: croissants at Du Pain et des Idées.',
    ruleSuggestedTags: ['#meeting'], reason: 'keyword: planning', expectedTags: ['travel'], wrongTags: ['meeting'] },
  { name: 'React guide → #tutorial 추가', path: 'Notes/react-setup.md',
    content: '# Setting Up React from Scratch\n\n```bash\nnpx create-react-app my-app --template typescript\nnpm install react-router-dom @tanstack/react-query\n```\n\n## Project Structure\nsrc/components/, hooks/, pages/, services/\n\nFollow this for clean separation.',
    ruleSuggestedTags: ['#project'], reason: 'keyword: project, setup', expectedTags: ['tutorial', 'reference', 'project'] },
  { name: 'Health insurance → #finance 추가', path: 'Notes/health-insurance.md',
    content: '# Health Insurance Comparison 2025\n\n| Plan | Premium | Deductible |\n|------|---------|----------|\n| A | $350/mo | $1,500 |\n| B | $500/mo | $500 |\n\nGoing with Plan B. Higher premium but lower out-of-pocket.\n\n- [ ] Enroll by December 15',
    ruleSuggestedTags: ['#health'], reason: 'keyword: health', expectedTags: ['health', 'finance'] },
  { name: 'Podcast notes → #reference 확인', path: 'Notes/podcast-notes.md',
    content: '# Lex Fridman #400 — Elon Musk\n\n## Key Points\n- AI safety: need proactive regulation\n- Mars: Starship on track for 2026 unmanned landing\n- Twitter/X: free speech platform vision\n\n## Quotes\n"The most entertaining outcome is the most likely."\n\n## Related\n- Sam Altman episode (#367)\n- Yann LeCun episode (#416)',
    ruleSuggestedTags: ['#reference'], reason: 'keyword: notes, reference', expectedTags: ['reference'] },
  { name: 'Meditation log → #journal 거부하지 않음', path: 'Notes/meditation-log.md',
    content: '# Meditation Practice Log\n\n## March 2025\n- 3/1: 10 min, guided (Headspace). Felt calm after.\n- 3/2: 15 min, unguided. Mind wandered a lot.\n- 3/5: 10 min, body scan. Noticed tension in shoulders.\n- 3/7: 20 min, loving-kindness. Best session this week.\n\n## Streak: 12 days\n## Goal: 30 consecutive days',
    ruleSuggestedTags: ['#journal'], reason: 'keyword: log, practice', expectedTags: ['journal', 'health'] },
  { name: 'Investment strategy → #finance 확인', path: 'Notes/investment-strategy.md',
    content: '# 2025 Investment Strategy\n\n## Allocation\n- 60% Index funds (VTI, VXUS)\n- 20% Bonds (BND)\n- 10% REITs (VNQ)\n- 10% Individual stocks\n\n## Rules\n- DCA $500/month\n- Rebalance quarterly\n- Never sell in a downturn\n- Max out 401k ($23,000)\n\n## Target\n- 7% annual return\n- $100k portfolio by Dec 2025',
    ruleSuggestedTags: ['#finance'], reason: 'keyword: investment, portfolio', expectedTags: ['finance'] },
  { name: 'Meeting + project 둘 다 해당', path: 'Notes/kickoff-meeting.md',
    content: '# Project Alpha Kickoff\n\n**Date**: April 1, 2025\n**Team**: Engineering (5), Design (2), PM (1)\n\n## Objectives\n- Define scope for Q2 deliverables\n- Assign ownership per workstream\n- Set biweekly sync cadence\n\n## Decisions\n- Use Next.js + Tailwind for frontend\n- PostgreSQL + Prisma for backend\n- 2-week sprint cycles\n\n## Action Items\n- [ ] PM: Create Jira board by April 3\n- [ ] Design: Wireframes by April 7',
    ruleSuggestedTags: ['#meeting'], reason: 'keyword: meeting, kickoff', expectedTags: ['meeting', 'project'] },
];

// ===========================================================================
// D. Duplicate Tag Detection — fixtures
// ===========================================================================

interface DupTagExpectedGroup {
  name: string;
  tags: readonly string[];
  method: 'normalization' | 'embedding';
}

interface DupTagFalsePositive {
  tagA: string;
  tagB: string;
}

function dupTagNotes(): Map<string, Note> {
  return new Map([
    note('Dev/react-hooks.md', '# React Hooks Guide\nLearn useState, useEffect, useContext.', ['#react', '#tutorial']),
    note('Dev/reactjs-patterns.md', '# ReactJS Design Patterns\nHOCs, render props, compound components.', ['#reactjs', '#reference']),
    note('Dev/js-closures.md', '# JavaScript Closures\nLexical scope, closure factory, memory.', ['#javascript', '#tutorial']),
    note('Dev/js-tricks.md', '# Quick JS Tips\nOptional chaining, nullish coalescing, spread.', ['#js', '#reference']),
    note('Dev/game-unity.md', '# Unity Game Development\n3D physics, shaders, animation system.', ['#GameDev', '#tutorial']),
    note('Dev/game-resources.md', '# Game Dev Resources\nAsset stores, communities, jam tools.', ['#game-dev', '#reference']),
    note('Research/ml-intro.md', '# Machine Learning Fundamentals\nSupervised, unsupervised, reinforcement.', ['#machine-learning', '#tutorial']),
    note('Research/ml-tools.md', '# ML Engineering Tools\nPyTorch, TensorFlow, MLflow, W&B.', ['#ML', '#reference']),
    note('Dev/frontend-css.md', '# Frontend CSS Tips\nGrid, flexbox, container queries.', ['#frontend', '#tutorial']),
    note('Dev/frontend-tools.md', '# Front-end Build Tools\nVite, webpack, esbuild, SWC.', ['#front-end', '#reference']),
    note('Data/data-analysis-python.md', '# Data Analysis with Python\nPandas DataFrame, NumPy arrays.', ['#data-analysis', '#tutorial']),
    note('Data/데이터분석-가이드.md', '# 데이터 분석 입문\n파이썬 판다스 기초, 시각화, 통계.', ['#데이터분석', '#tutorial']),
    note('Dev/python-automation.md', '# Python Automation Scripts\nFile handling, web scraping, CLI tools.', ['#python', '#tutorial']),
    note('Dev/java-spring.md', '# Java Spring Boot\nREST APIs, dependency injection, JPA.', ['#java', '#reference']),
    note('Dev/typescript-generics.md', '# TypeScript Generics\nType inference, conditional types, mapped.', ['#typescript', '#tutorial']),
    note('Dev/css-animations.md', '# CSS Animations\nKeyframes, transitions, performance tips.', ['#css', '#reference']),
    note('Dev/vue-composition.md', '# Vue 3 Composition API\nReactive state, composables, provide/inject.', ['#vue', '#tutorial']),
  ]);
}

const DUP_TAG_EXPECTED_GROUPS: readonly DupTagExpectedGroup[] = [
  { name: 'GameDev + game-dev', tags: ['#GameDev', '#game-dev'], method: 'normalization' },
  { name: 'frontend + front-end', tags: ['#frontend', '#front-end'], method: 'normalization' },
  { name: 'machine-learning + ML', tags: ['#machine-learning', '#ML'], method: 'embedding' },
  { name: 'react + reactjs', tags: ['#react', '#reactjs'], method: 'embedding' },
  { name: 'javascript + js', tags: ['#javascript', '#js'], method: 'embedding' },
  { name: '데이터분석 + data-analysis', tags: ['#데이터분석', '#data-analysis'], method: 'embedding' },
];

const DUP_TAG_FALSE_POSITIVES: readonly DupTagFalsePositive[] = [
  { tagA: '#java', tagB: '#javascript' },
  { tagA: '#react', tagB: '#vue' },
  { tagA: '#css', tagB: '#typescript' },
  { tagA: '#python', tagB: '#java' },
];

// ===========================================================================
// Tests
// ===========================================================================

describe.skipIf(!RUN)('Golden Set — AI 품질 벤치마크 (Gemini)', () => {
  let ai: GeminiFetchAdapter;

  beforeAll(() => { ai = new GeminiFetchAdapter(GEMINI_API_KEY!); });

  afterAll(() => {
    const W = 76;
    const line = '─'.repeat(W - 2);
    const pad = (s: string) => `│${s.padEnd(W - 2)}│`;

    console.log(`\n┌${line}┐`);
    console.log(`│${'GOLDEN SET QUALITY REPORT'.padStart((W - 2 + 24) / 2).padEnd(W - 2)}│`);
    console.log(`├${line}┤`);

    // A. Folder
    const fc = folderResults.filter(r => r.correct).length;
    console.log(pad(''));
    console.log(pad(`  A. FOLDER CLASSIFICATION                      ${fc}/${folderResults.length} correct`));
    console.log(pad(`  ${line.substring(0, W - 6)}`));
    for (const r of folderResults) {
      console.log(pad(`  ${r.correct ? '✓' : '✗'} ${r.fixture.padEnd(32)} → ${r.actual.padEnd(14)} exp: ${r.expected.join('|')}`));
    }

    // B. Tags
    let totalExp = 0, totalHit = 0, totalMiss = 0, totalExtra = 0;
    for (const r of tagResults) { totalExp += r.expected.length; totalHit += r.hits.length; totalMiss += r.missed.length; totalExtra += r.extra.length; }
    console.log(pad(''));
    console.log(pad(`  B. TAG ACCURACY                               ${totalHit}/${totalExp} expected tags hit`));
    console.log(pad(`  ${line.substring(0, W - 6)}`));
    for (const r of tagResults) {
      const mark = r.missed.length === 0 ? '✓' : '△';
      let detail = `[${r.hits.join(',')}]`;
      if (r.missed.length > 0) detail += `  miss:[${r.missed.join(',')}]`;
      if (r.extra.length > 0) detail += `  extra:[${r.extra.join(',')}]`;
      console.log(pad(`  ${mark} ${r.fixture.padEnd(32)} ${detail}`));
    }

    // C. Links
    const lr = linkResults.filter(r => r.resolved).length;
    const lc = linkResults.filter(r => r.correctTarget).length;
    console.log(pad(''));
    console.log(pad(`  C. BROKEN LINK RESOLUTION                     ${lr}/${linkResults.length} resolved, ${lc}/${linkResults.length} correct`));
    console.log(pad(`  ${line.substring(0, W - 6)}`));
    for (const r of linkResults) {
      const mark = r.correctTarget ? '✓' : r.resolved ? '△' : '✗';
      console.log(pad(`  ${mark} [[${r.brokenLink}]] → ${r.actual}`));
    }

    // D. Wrong tag rejection
    if (tagRejectionResults.length > 0) {
      const wr = tagRejectionResults.filter(r => r.rejected).length;
      console.log(pad(''));
      console.log(pad(`  D. WRONG TAG REJECTION                        ${wr}/${tagRejectionResults.length} correctly rejected`));
      console.log(pad(`  ${line.substring(0, W - 6)}`));
      for (const r of tagRejectionResults) {
        console.log(pad(`  ${r.rejected ? '✓' : '✗'} "${r.wrongTag}" rejected → AI: [${r.aiSuggested.join(', ')}]`));
      }
    }

    // E. Duplicate Tag Detection
    if (dupTagResults.length > 0) {
      const normFound = dupTagResults.filter(r => r.method === 'normalization' && r.found).length;
      const normTotal = dupTagResults.filter(r => r.method === 'normalization').length;
      const embFound = dupTagResults.filter(r => r.method === 'embedding' && r.found).length;
      const embTotal = dupTagResults.filter(r => r.method === 'embedding').length;
      const fpCorrect = falsePositiveResults.filter(r => r.correctlySeparated).length;
      console.log(pad(''));
      console.log(pad(`  E. DUPLICATE TAG DETECTION                     norm: ${normFound}/${normTotal}, embed: ${embFound}/${embTotal}`));
      console.log(pad(`  ${line.substring(0, W - 6)}`));
      for (const r of dupTagResults) {
        const mark = r.found ? '✓' : '✗';
        const method = r.method === 'normalization' ? '[norm]' : '[embd]';
        const actual = r.found ? `→ [${r.actualGroup.join(', ')}]` : '(not grouped)';
        console.log(pad(`  ${mark} ${method} ${r.groupName.padEnd(28)} ${actual}`));
      }
      if (falsePositiveResults.length > 0) {
        console.log(pad(`  False Positives: ${fpCorrect}/${falsePositiveResults.length} correctly separated`));
        for (const r of falsePositiveResults) {
          console.log(pad(`  ${r.correctlySeparated ? '✓' : '✗'} ${r.tagA} ≠ ${r.tagB}`));
        }
      }
    }

    // Summary
    const wr = tagRejectionResults.filter(r => r.rejected).length;
    const normOk = dupTagResults.filter(r => r.method === 'normalization' && r.found).length;
    const normAll = dupTagResults.filter(r => r.method === 'normalization').length;
    const embOk = dupTagResults.filter(r => r.method === 'embedding' && r.found).length;
    const embAll = dupTagResults.filter(r => r.method === 'embedding').length;
    const fpOk = falsePositiveResults.filter(r => r.correctlySeparated).length;

    console.log(pad(''));
    console.log(`├${line}┤`);
    console.log(pad(`  SUMMARY                                        threshold`));
    console.log(pad(`  Folder:          ${fc}/${folderResults.length}                                      ≥75%  ${fc >= Math.ceil(folderResults.length * 0.75) ? 'PASS' : 'FAIL'}`));
    console.log(pad(`  Tag (hit/exp):   ${totalHit}/${totalExp}  (miss: ${totalMiss}, extra: ${totalExtra})                ≥75%  ${totalExp > 0 && totalHit / totalExp >= 0.75 ? 'PASS' : 'FAIL'}`));
    console.log(pad(`  Link resolved:   ${lr}/${linkResults.length}  (correct: ${lc}/${linkResults.length})                     ≥50%  ${linkResults.length > 0 && lr / linkResults.length >= 0.50 ? 'PASS' : 'FAIL'}`));
    if (tagRejectionResults.length > 0) console.log(pad(`  Wrong rejected:  ${wr}/${tagRejectionResults.length}`));
    if (normAll > 0) console.log(pad(`  Dup (norm):      ${normOk}/${normAll}                                      =100% ${normOk === normAll ? 'PASS' : 'FAIL'}`));
    if (embAll > 0) console.log(pad(`  Dup (embed):     ${embOk}/${embAll}                                       ≥33%  ${embAll > 0 && embOk / embAll >= 0.33 ? 'PASS' : 'FAIL'}`));
    if (falsePositiveResults.length > 0) console.log(pad(`  False positive:  ${fpOk}/${falsePositiveResults.length}                                      =100% ${fpOk === falsePositiveResults.length ? 'PASS' : 'FAIL'}`));
    console.log(`└${line}┘\n`);
  });

  // =========================================================================
  // A. Orphan Note Reposition
  // =========================================================================

  describe('A. Orphan Note Reposition', () => {
    for (const f of ORPHAN_FIXTURES) {
      it(f.name, async () => {
        const notes = vaultNotes();
        const [p, n] = note(f.path, f.content);
        notes.set(p, n);
        const ports = buildPorts(notes);
        const uc = new GenerateOrganizeVaultUseCase(ports.clock, ports.vault, ports.searchIndex, ports.store, ai, ports.config);
        const plan: MaintenancePlan = {
          orphanNotes: [{ notePath: createNotePath(f.path), fileSize: f.content.length }],
          brokenLinks: [], duplicateTags: [], missingTags: [], emptyNotes: [],
          duplicateCandidates: [], untaggedNotes: [], timestamp: Date.now() as any,
        };
        const result = await uc.execute(plan);
        expect(result.proposals.length).toBe(1);
        const prop = result.proposals[0];
        const actualFolder = prop.diffs.find(d => d.field === 'folder')?.after ?? '(no move)';
        const actualTags = parseTags(prop.diffs.find(d => d.field === 'tags')?.after ?? '');
        const correct = f.acceptableFolders.some(af => actualFolder.toLowerCase().replace(/\/$/, '') === af.toLowerCase());
        const expSet = new Set(f.expectedTags.map(normTag));
        folderResults.push({ fixture: f.name, expected: f.acceptableFolders, actual: actualFolder, correct });
        tagResults.push({
          fixture: f.name, expected: f.expectedTags.map(normTag), actual: actualTags,
          hits: actualTags.filter(t => expSet.has(t)),
          missed: f.expectedTags.map(normTag).filter(t => !actualTags.includes(t)),
          extra: actualTags.filter(t => !expSet.has(t)),
        });
        expect(correct).toBe(true);
      }, 30_000);
    }
  });

  // =========================================================================
  // B. Broken Link Inference
  // =========================================================================

  describe('B. Broken Link Inference', () => {
    for (const f of BROKEN_LINK_FIXTURES) {
      it(f.name, async () => {
        const notes = vaultNotes();
        for (const [p, n] of f.extraNotes) notes.set(p, n);
        const ports = buildPorts(notes);
        const uc = new GenerateOrganizeVaultUseCase(ports.clock, ports.vault, ports.searchIndex, ports.store, ai, ports.config);
        const plan: MaintenancePlan = {
          orphanNotes: [], duplicateTags: [], missingTags: [], emptyNotes: [],
          brokenLinks: [{ sourcePath: createNotePath(f.sourcePath), targetLink: f.targetLink, lineNumber: f.lineNumber }],
          duplicateCandidates: [], untaggedNotes: [], timestamp: Date.now() as any,
        };
        const result = await uc.execute(plan);
        expect(result.proposals.length).toBe(1);
        const prop = result.proposals[0];
        const after = prop.diffs.find(d => d.field === 'link')!.after;
        const resolved = after.startsWith('[[') && after.endsWith(']]');
        const correctTarget = resolved && f.expectedTargetKeywords.some(k => after.toLowerCase().includes(k.toLowerCase()));
        linkResults.push({ fixture: f.name, brokenLink: f.targetLink, expectedTarget: f.expectedTargetKeywords, actual: after, resolved, correctTarget });
        expect(prop.type).toBe('fix-broken-link');
      }, 30_000);
    }
  });

  // =========================================================================
  // C. Missing Tag Validation
  // =========================================================================

  describe('C. Missing Tag Validation', () => {
    for (const f of MISSING_TAG_FIXTURES) {
      it(f.name, async () => {
        const notes = vaultNotes();
        const [p, n] = note(f.path, f.content);
        notes.set(p, n);
        const ports = buildPorts(notes);
        const uc = new GenerateOrganizeVaultUseCase(ports.clock, ports.vault, ports.searchIndex, ports.store, ai, ports.config);
        const plan: MaintenancePlan = {
          orphanNotes: [], brokenLinks: [], duplicateTags: [], emptyNotes: [],
          missingTags: [{ notePath: createNotePath(f.path), suggestedTags: f.ruleSuggestedTags as any, reason: f.reason }],
          duplicateCandidates: [], untaggedNotes: [], timestamp: Date.now() as any,
        };
        const result = await uc.execute(plan);
        expect(result.proposals.length).toBe(1);
        const prop = result.proposals[0];
        const actualTags = parseTags(prop.diffs.find(d => d.field === 'tags')!.after);
        const expSet = new Set(f.expectedTags.map(normTag));
        tagResults.push({
          fixture: f.name, expected: f.expectedTags.map(normTag), actual: actualTags,
          hits: actualTags.filter(t => expSet.has(t)),
          missed: f.expectedTags.map(normTag).filter(t => !actualTags.includes(t)),
          extra: actualTags.filter(t => !expSet.has(t)),
        });
        if (f.wrongTags) {
          for (const wt of f.wrongTags) {
            tagRejectionResults.push({ fixture: f.name, wrongTag: wt, rejected: !actualTags.includes(normTag(wt)), aiSuggested: actualTags });
          }
        }
        expect(actualTags.filter(t => expSet.has(t)).length).toBeGreaterThanOrEqual(1);
      }, 30_000);
    }
  });

  // =========================================================================
  // D. Duplicate Tag Detection (embedding + normalization)
  // =========================================================================

  describe('D. Duplicate Tag Detection', () => {
    it('detects duplicate tags via normalization + embedding similarity', async () => {
      const notes = dupTagNotes();
      const ports = buildPorts(notes);

      const maintenance = new RunMaintenanceUseCase(
        ports.vault, ports.searchIndex, ports.config, ports.clock,
        undefined, undefined, ai,
      );

      const plan = await maintenance.execute();
      const groups = plan.duplicateTags;

      function tagsInSameGroup(tagA: string, tagB: string): DuplicateTagGroup | undefined {
        const a = tagA.replace(/^#/, '').toLowerCase();
        const b = tagB.replace(/^#/, '').toLowerCase();
        return groups.find(g => {
          const variantTags = g.variants.map(v => (v.tag as string).replace(/^#/, '').toLowerCase());
          return variantTags.includes(a) && variantTags.includes(b);
        });
      }

      for (const expected of DUP_TAG_EXPECTED_GROUPS) {
        const tagA = expected.tags[0];
        const tagB = expected.tags[1];
        const group = tagsInSameGroup(tagA, tagB);
        const found = !!group;
        const actualGroup = group
          ? group.variants.map(v => v.tag as string)
          : [];
        dupTagResults.push({
          groupName: expected.name,
          method: expected.method,
          expectedTags: expected.tags,
          found,
          actualGroup,
        });
      }

      for (const fp of DUP_TAG_FALSE_POSITIVES) {
        const group = tagsInSameGroup(fp.tagA, fp.tagB);
        falsePositiveResults.push({
          tagA: fp.tagA, tagB: fp.tagB,
          correctlySeparated: !group,
        });
      }

      const normFound = dupTagResults.filter(r => r.method === 'normalization' && r.found).length;
      const normTotal = dupTagResults.filter(r => r.method === 'normalization').length;
      expect(normFound).toBe(normTotal);

      const embFound = dupTagResults.filter(r => r.method === 'embedding' && r.found).length;
      const embTotal = dupTagResults.filter(r => r.method === 'embedding').length;
      expect(embFound).toBeGreaterThanOrEqual(Math.ceil(embTotal * 0.25));
    }, 60_000);
  });
});
