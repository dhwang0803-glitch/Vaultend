import { describe, it, expect, vi, beforeAll } from 'vitest';
import { GenerateOrganizeVaultUseCase } from '../GenerateOrganizeVaultUseCase';
import type { AIProviderPort, CompletionRequest, CompletionResponse, ClassificationResponse, EmbeddingResponse } from '../../ports/AIProviderPort';
import type { VaultAccessPort } from '../../ports/VaultAccessPort';
import type { SearchIndexPort, SearchResult } from '../../ports/SearchIndexPort';
import type { OrganizeVaultPort } from '../../ports/OrganizeVaultPort';
import type { ConfigPort, PluginSettings } from '../../ports/ConfigPort';
import type { ClockPort } from '../../ports/ClockPort';
import type { MaintenancePlan } from '../../../domain/models/OrganizeModels';
import type { Note } from '../../../domain/models/Note';
import { createNotePath, NotePath } from '../../../domain/values/NotePath';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RUN = !!GEMINI_API_KEY;

class GeminiFetchAdapter implements AIProviderPort {
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-2.5-flash',
  ) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const contents = [{ parts: [{ text: request.prompt }] }];
    const systemInstruction = request.systemPrompt
      ? { parts: [{ text: request.systemPrompt }] }
      : undefined;

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      ...(systemInstruction ? { systemInstruction } : {}),
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const result = await response.json() as any;
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage = result.usageMetadata ?? {};

    return {
      content,
      tokenUsage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
        estimatedCostUsd: 0,
      },
      finishReason: 'stop',
    };
  }

  async callClassification(): Promise<ClassificationResponse> {
    throw new Error('Not used in this test');
  }

  async callEmbedding(): Promise<EmbeddingResponse> {
    throw new Error('Not used in this test');
  }
}

function createMockNote(path: string, content: string, tags: string[] = []): Note {
  return {
    id: path as any,
    path: createNotePath(path),
    title: path.split('/').pop()?.replace('.md', '') as any,
    content,
    metadata: {
      tags: tags as any,
      links: [],
      frontmatter: {},
      created: Date.now() as any,
      modified: Date.now() as any,
    },
    chunks: [],
  };
}

function buildMockPorts(notes: Map<string, Note>) {
  const savedPlans: any[] = [];

  const vault: VaultAccessPort = {
    readNote: vi.fn(async (path: NotePath) => notes.get(path as string) ?? null),
    listNotes: vi.fn(async () => [...notes.keys()].map(createNotePath)),
    writeNote: vi.fn(),
    moveNote: vi.fn(),
    deleteNote: vi.fn(),
    createNote: vi.fn(),
    updateFrontmatter: vi.fn(),
    readFileRaw: vi.fn(async () => null),
    writeFileRaw: vi.fn(),
    listFiles: vi.fn(async () => []),
    watchEvents: vi.fn(() => () => {}),
  } as unknown as VaultAccessPort;

  const searchIndex: SearchIndexPort = {
    search: vi.fn(async (query: string, limit: number): Promise<SearchResult[]> => {
      const results: SearchResult[] = [];
      for (const [path, note] of notes) {
        const name = path.split('/').pop()?.replace('.md', '') ?? '';
        if (name.toLowerCase().includes(query.toLowerCase()) ||
            query.toLowerCase().includes(name.toLowerCase())) {
          results.push({
            notePath: createNotePath(path),
            chunk: { content: note.content.substring(0, 200), startLine: 0, endLine: 5 } as any,
            score: 0.8,
          });
        }
      }
      return results.slice(0, limit);
    }),
    index: vi.fn(),
    remove: vi.fn(),
    rebuild: vi.fn(),
  };

  const store: OrganizeVaultPort = {
    save: vi.fn(async (plan: any) => { savedPlans.push(plan); }),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    delete: vi.fn(),
    updateProposalStatus: vi.fn(async () => null),
    updateStatus: vi.fn(async () => null),
  };

  const config: ConfigPort = {
    getSettings: vi.fn(async (): Promise<PluginSettings> => ({
      aiProvider: 'gemini',
      aiApiKey: GEMINI_API_KEY!,
      aiModel: 'gemini-2.5-flash',
      aiMaxTokens: 8192,
      aiTemperature: 0.7,
      ollamaBaseUrl: '',
      deepseekApiKey: '',
      deepseekModel: '',
      customBaseUrl: '',
      customApiKey: '',
      customModel: '',
      captureFolder: 'Inbox',
      autoApplyOrganize: false,
      defaultSaveFolder: 'QuickAsk',
      defaultSaveTarget: 'new-note',
      quickAskSaveMode: 'timestamp',
      dailyNoteSizeLimitKB: 200,
      maxContextChunks: 5,
      dailyNoteFormat: 'YYYY-MM-DD',
      dailyNoteFolder: 'DailyNotes',
      maintenanceEnabled: false,
      maintenanceIntervalMinutes: 60,
      smartScheduling: false,
      maintenanceExcludeFolders: [],
      maintenanceExcludeFiles: [],
      maintenanceExcludeTags: [],
      maintenanceArchiveFolder: 'Archive',
      organizeConfidenceThreshold: 0,
      embeddingsEnabled: false,
      embeddingsModel: '',
      rrfEmbeddingWeight: 4.0,
      rrfK: 20,
      privacyRules: [],
      knownTags: ['#recipe', '#journal', '#project', '#meeting', '#reference', '#tutorial'],
      trackTokenUsage: true,
      locale: 'en',
      licenseKey: '',
      proGraceDeadline: 0,
    })),
    saveSettings: vi.fn(),
    updateSettings: vi.fn(),
  };

  const clock: ClockPort = {
    now: () => Date.now() as any,
  };

  return { vault, searchIndex, store, config, clock, savedPlans };
}

describe.skipIf(!RUN)('GenerateOrganizeVaultUseCase — Integration (Gemini API)', () => {
  let ai: GeminiFetchAdapter;

  beforeAll(() => {
    ai = new GeminiFetchAdapter(GEMINI_API_KEY!);
  });

  it('AI가 고아 노트에 대해 폴더/태그 재배치를 제안한다', async () => {
    const notes = new Map<string, Note>();
    notes.set('Inbox/chicken-curry-recipe.md', createMockNote(
      'Inbox/chicken-curry-recipe.md',
      '# Chicken Curry Recipe\n\nIngredients: chicken, curry powder, coconut milk, onion, garlic.\n\nSteps:\n1. Sauté onion and garlic\n2. Add chicken and curry powder\n3. Pour coconut milk and simmer for 20 minutes',
    ));
    notes.set('Inbox/2024-meeting-notes.md', createMockNote(
      'Inbox/2024-meeting-notes.md',
      '# Q1 Planning Meeting\n\nAttendees: Alice, Bob, Charlie\n\nAgenda:\n- Review Q4 performance\n- Set Q1 OKRs\n- Budget allocation\n\nAction items:\n- Alice: prepare report by Jan 15\n- Bob: finalize roadmap',
    ));
    notes.set('Recipes/pasta.md', createMockNote('Recipes/pasta.md', '# Pasta Recipe\nBoil pasta.'));
    notes.set('Meetings/standup.md', createMockNote('Meetings/standup.md', '# Daily Standup\nUpdates.'));
    notes.set('Projects/website.md', createMockNote('Projects/website.md', '# Website Redesign\nIn progress.'));

    const { vault, searchIndex, store, config, clock, savedPlans } = buildMockPorts(notes);

    const useCase = new GenerateOrganizeVaultUseCase(clock, vault, searchIndex, store, ai, config);

    const plan: MaintenancePlan = {
      orphanNotes: [
        { notePath: createNotePath('Inbox/chicken-curry-recipe.md'), fileSize: 300 },
        { notePath: createNotePath('Inbox/2024-meeting-notes.md'), fileSize: 450 },
      ],
      brokenLinks: [],
      duplicateTags: [],
      missingTags: [],
      emptyNotes: [],
      duplicateCandidates: [],
      untaggedNotes: [],
      timestamp: Date.now() as any,
    };

    const result = await useCase.execute(plan);

    console.log('\n=== Orphan Note Proposals ===');
    for (const p of result.proposals) {
      console.log(`[${p.type}] ${p.targetPath as string}`);
      console.log(`  Confidence: ${p.confidence} (${p.confidenceLevel})`);
      console.log(`  Diffs: ${JSON.stringify(p.diffs)}`);
      console.log(`  Rationale: ${p.rationale}`);
    }

    expect(result.proposals.length).toBe(2);
    expect(result.status).toBe('draft');

    for (const proposal of result.proposals) {
      expect(proposal.type).toBe('reposition');
      expect(proposal.status).toBe('pending');
      expect(proposal.confidence).toBeGreaterThan(0);
      expect(proposal.confidence).toBeLessThanOrEqual(0.95);
      expect(proposal.rationale.length).toBeGreaterThan(5);
      expect(proposal.diffs.length).toBeGreaterThan(0);
    }

    const recipeProposal = result.proposals.find(
      p => (p.targetPath as string).includes('chicken-curry'),
    )!;
    expect(recipeProposal).toBeDefined();
    const folderDiff = recipeProposal.diffs.find(d => d.field === 'folder');
    if (folderDiff) {
      console.log(`\n  Recipe → suggested folder: ${folderDiff.after}`);
      expect(folderDiff.after).not.toBe('Inbox');
    }

    expect(savedPlans.length).toBe(1);
  }, 30_000);

  it('AI가 깨진 링크에 대해 대체 대상을 추론한다', async () => {
    const notes = new Map<string, Note>();
    notes.set('Notes/my-note.md', createMockNote(
      'Notes/my-note.md',
      '# My Note\n\nSee also [[pasta recipe]] for dinner ideas.',
    ));
    notes.set('Recipes/pasta.md', createMockNote(
      'Recipes/pasta.md',
      '# Pasta Recipe\n\nBoil pasta. Add sauce. Serve.',
      ['#recipe'],
    ));
    notes.set('Recipes/pizza.md', createMockNote(
      'Recipes/pizza.md',
      '# Pizza Recipe\n\nMake dough. Add toppings. Bake.',
      ['#recipe'],
    ));

    const { vault, searchIndex, store, config, clock } = buildMockPorts(notes);

    const useCase = new GenerateOrganizeVaultUseCase(clock, vault, searchIndex, store, ai, config);

    const plan: MaintenancePlan = {
      orphanNotes: [],
      brokenLinks: [
        {
          sourcePath: createNotePath('Notes/my-note.md'),
          targetLink: 'pasta recipe',
          lineNumber: 3,
        },
      ],
      duplicateTags: [],
      missingTags: [],
      emptyNotes: [],
      duplicateCandidates: [],
      untaggedNotes: [],
      timestamp: Date.now() as any,
    };

    const result = await useCase.execute(plan);

    console.log('\n=== Broken Link Proposals ===');
    for (const p of result.proposals) {
      console.log(`[${p.type}] ${p.targetPath as string}`);
      console.log(`  Confidence: ${p.confidence} (${p.confidenceLevel})`);
      console.log(`  Diffs: ${JSON.stringify(p.diffs)}`);
      console.log(`  Rationale: ${p.rationale}`);
    }

    expect(result.proposals.length).toBe(1);
    const linkProposal = result.proposals[0];
    expect(linkProposal.type).toBe('fix-broken-link');

    const linkDiff = linkProposal.diffs.find(d => d.field === 'link');
    expect(linkDiff).toBeDefined();
    expect(linkDiff!.before).toBe('[[pasta recipe]]');

    if (linkDiff!.after.startsWith('[[')) {
      console.log(`\n  Broken link resolved to: ${linkDiff!.after}`);
      expect(linkDiff!.after.toLowerCase()).toContain('pasta');
    }
  }, 30_000);

  it('AI가 누락 태그 제안을 검증/보강한다', async () => {
    const notes = new Map<string, Note>();
    notes.set('Notes/quick-pasta.md', createMockNote(
      'Notes/quick-pasta.md',
      '# Quick Pasta Guide\n\n## Ingredients\n- Spaghetti\n- Olive oil\n- Garlic\n- Parmesan\n\n## Steps\n1. Boil spaghetti\n2. Sauté garlic in olive oil\n3. Toss with cheese\n\nPerfect for a weeknight dinner.',
    ));
    notes.set('Notes/project-kickoff.md', createMockNote(
      'Notes/project-kickoff.md',
      '# Project Kickoff\n\n## Objectives\n- Define scope and deliverables\n- Assign team roles\n- Set timeline milestones\n\n## Team\n- Lead: Alice\n- Dev: Bob, Charlie\n- Design: Diana\n\n## Timeline\n- Week 1: Requirements gathering\n- Week 2-3: Development\n- Week 4: Testing and launch',
    ));

    const { vault, searchIndex, store, config, clock } = buildMockPorts(notes);

    const useCase = new GenerateOrganizeVaultUseCase(clock, vault, searchIndex, store, ai, config);

    const plan: MaintenancePlan = {
      orphanNotes: [],
      brokenLinks: [],
      duplicateTags: [],
      missingTags: [
        {
          notePath: createNotePath('Notes/quick-pasta.md'),
          suggestedTags: ['#recipe' as any],
          reason: 'Contains cooking-related keywords',
        },
        {
          notePath: createNotePath('Notes/project-kickoff.md'),
          suggestedTags: ['#meeting' as any, '#project' as any],
          reason: 'Contains project planning keywords',
        },
      ],
      emptyNotes: [],
      duplicateCandidates: [],
      untaggedNotes: [],
      timestamp: Date.now() as any,
    };

    const result = await useCase.execute(plan);

    console.log('\n=== Missing Tag Proposals ===');
    for (const p of result.proposals) {
      console.log(`[${p.type}] ${p.targetPath as string}`);
      console.log(`  Confidence: ${p.confidence} (${p.confidenceLevel})`);
      console.log(`  Diffs: ${JSON.stringify(p.diffs)}`);
      console.log(`  Rationale: ${p.rationale}`);
    }

    expect(result.proposals.length).toBe(2);

    for (const proposal of result.proposals) {
      expect(proposal.type).toBe('apply-missing-tags');
      expect(proposal.confidence).toBeGreaterThan(0.3);
      expect(proposal.confidence).toBeLessThanOrEqual(0.95);

      const tagDiff = proposal.diffs.find(d => d.field === 'tags');
      expect(tagDiff).toBeDefined();
      expect(tagDiff!.after.length).toBeGreaterThan(0);
    }

    const pastaProposal = result.proposals.find(
      p => (p.targetPath as string).includes('quick-pasta'),
    )!;
    const pastaTags = pastaProposal.diffs.find(d => d.field === 'tags')!.after.toLowerCase();
    console.log(`\n  Pasta note AI tags: ${pastaTags}`);
    expect(pastaTags).toContain('recipe');
  }, 30_000);

  it('규칙 기반: 빈 노트 + 중복 태그는 AI 없이 proposal을 생성한다', async () => {
    const notes = new Map<string, Note>();
    notes.set('Notes/empty.md', createMockNote('Notes/empty.md', ''));
    notes.set('Notes/a.md', createMockNote('Notes/a.md', 'Content', ['#javascript', '#js']));
    notes.set('Notes/b.md', createMockNote('Notes/b.md', 'Content', ['#js']));

    const { vault, searchIndex, store, config, clock } = buildMockPorts(notes);

    const noopAi: AIProviderPort = {
      callCompletion: vi.fn(async () => { throw new Error('Should not be called'); }),
      callClassification: vi.fn(async () => { throw new Error('Should not be called'); }),
      callEmbedding: vi.fn(async () => { throw new Error('Should not be called'); }),
    };

    const useCase = new GenerateOrganizeVaultUseCase(clock, vault, searchIndex, store, noopAi, config);

    const plan: MaintenancePlan = {
      orphanNotes: [],
      brokenLinks: [],
      duplicateTags: [
        {
          canonicalTag: '#javascript' as any,
          variants: [
            { tag: '#js' as any, count: 2 },
            { tag: '#javascript' as any, count: 1 },
          ],
          affectedNotes: [createNotePath('Notes/a.md'), createNotePath('Notes/b.md')],
        },
      ],
      missingTags: [],
      emptyNotes: [
        { notePath: createNotePath('Notes/empty.md'), backlinkCount: 0, backlinkPaths: [] },
      ],
      duplicateCandidates: [],
      untaggedNotes: [],
      timestamp: Date.now() as any,
    };

    const result = await useCase.execute(plan);

    console.log('\n=== Rule-based Proposals ===');
    for (const p of result.proposals) {
      console.log(`[${p.type}] ${p.targetPath as string} — confidence ${p.confidence}`);
    }

    const archiveProposal = result.proposals.find(p => p.type === 'archive-empty');
    expect(archiveProposal).toBeDefined();
    expect(archiveProposal!.confidence).toBe(0.9);

    const mergeProposal = result.proposals.find(p => p.type === 'merge-duplicate-tags');
    expect(mergeProposal).toBeDefined();
    expect(mergeProposal!.confidence).toBe(0.85);

    expect(noopAi.callCompletion).not.toHaveBeenCalled();
  });

  it('AI 실패 시 규칙 기반 폴백으로 proposal을 생성한다', async () => {
    const notes = new Map<string, Note>();
    notes.set('Inbox/test.md', createMockNote(
      'Inbox/test.md',
      '# Test Note\n\nSome content about testing software.',
    ));

    const { vault, searchIndex, store, config, clock } = buildMockPorts(notes);

    const failingAi: AIProviderPort = {
      callCompletion: vi.fn(async () => { throw new Error('API unavailable'); }),
      callClassification: vi.fn(async () => { throw new Error('API unavailable'); }),
      callEmbedding: vi.fn(async () => { throw new Error('API unavailable'); }),
    };

    const useCase = new GenerateOrganizeVaultUseCase(clock, vault, searchIndex, store, failingAi, config);

    const plan: MaintenancePlan = {
      orphanNotes: [
        { notePath: createNotePath('Inbox/test.md'), fileSize: 100 },
      ],
      brokenLinks: [],
      duplicateTags: [],
      missingTags: [
        {
          notePath: createNotePath('Inbox/test.md'),
          suggestedTags: ['#testing' as any],
          reason: 'keyword match',
        },
      ],
      emptyNotes: [],
      duplicateCandidates: [],
      untaggedNotes: [],
      timestamp: Date.now() as any,
    };

    const result = await useCase.execute(plan);

    console.log('\n=== Fallback Proposals (AI failed) ===');
    for (const p of result.proposals) {
      console.log(`[${p.type}] ${p.targetPath as string} — confidence ${p.confidence}`);
      console.log(`  Rationale: ${p.rationale}`);
    }

    expect(result.proposals.length).toBe(2);

    const repositionFallback = result.proposals.find(p => p.type === 'reposition');
    expect(repositionFallback).toBeDefined();
    expect(repositionFallback!.confidence).toBe(0.6);
    expect(repositionFallback!.rationale).toContain('No backlinks');

    const tagFallback = result.proposals.find(p => p.type === 'apply-missing-tags');
    expect(tagFallback).toBeDefined();
    expect(tagFallback!.confidence).toBe(0.65);
    expect(tagFallback!.rationale).toBe('keyword match');
  });
});
