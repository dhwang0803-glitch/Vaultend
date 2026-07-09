import { MaintenancePlan, DuplicatePair, BrokenLink, MissingTagSuggestion } from '../../domain/models/OrganizeModels';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName } from '../../domain/values/TagName';

export class RunMaintenanceUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Vault 전체 유지보수 스캔을 실행한다.
   *
   * 1. 모든 노트 목록 조회
   * 2. 고아 노트 탐지 (백링크 0개)
   * 3. 중복 후보 탐지 (제목 유사도 + 내용 유사도)
   * 4. 깨진 링크 탐지
   * 5. 누락 태그 제안
   * 6. 결과를 MaintenancePlan으로 반환
   */
  async execute(): Promise<MaintenancePlan> {
    const allNotes = await this.vault.listNotes();
    const now = this.clock.now();

    // 고아 노트 탐지
    const orphanNotes = await this.findOrphanNotes(allNotes);

    // 중복 후보 탐지
    const duplicateCandidates = await this.findDuplicates(allNotes);

    // 깨진 링크 탐지
    const brokenLinks = await this.findBrokenLinks(allNotes);

    // 누락 태그 제안
    const missingTags = await this.suggestMissingTags(allNotes);

    return {
      orphanNotes,
      duplicateCandidates,
      brokenLinks,
      missingTags,
      timestamp: now,
    };
  }

  private async findOrphanNotes(allNotes: ReadonlyArray<NotePath>): Promise<NotePath[]> {
    const orphans: NotePath[] = [];
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (note && note.metadata.backlinks.length === 0 && note.metadata.links.length === 0) {
        orphans.push(notePath);
      }
    }
    return orphans;
  }

  private async findDuplicates(allNotes: ReadonlyArray<NotePath>): Promise<DuplicatePair[]> {
    const tokenIndex = new Map<string, NotePath[]>();

    for (const notePath of allNotes) {
      const tokens = this.tokenizeTitle(notePath);
      for (const token of tokens) {
        const list = tokenIndex.get(token) ?? [];
        list.push(notePath);
        tokenIndex.set(token, list);
      }
    }

    const candidateScores = new Map<string, { a: NotePath; b: NotePath; tokensA: string[]; tokensB: string[] }>();
    for (const [, paths] of tokenIndex) {
      if (paths.length < 2 || paths.length > 50) continue;
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const key = `${paths[i]}|${paths[j]}`;
          if (!candidateScores.has(key)) {
            candidateScores.set(key, {
              a: paths[i], b: paths[j],
              tokensA: this.tokenizeTitle(paths[i]),
              tokensB: this.tokenizeTitle(paths[j]),
            });
          }
        }
      }
    }

    const pairs: DuplicatePair[] = [];
    for (const [, { a, b, tokensA, tokensB }] of candidateScores) {
      const setB = new Set(tokensB);
      const intersection = tokensA.filter(t => setB.has(t)).length;
      const union = new Set([...tokensA, ...tokensB]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard >= 0.6) {
        pairs.push({ noteA: a, noteB: b, similarityScore: jaccard, reason: 'Title similarity' });
      }
    }

    return pairs.sort((x, y) => y.similarityScore - x.similarityScore);
  }

  private tokenizeTitle(path: NotePath): string[] {
    const basename = (path as string).split('/').pop()?.replace('.md', '') ?? '';
    return basename.toLowerCase().split(/[\s\-_]+/).filter(t => t.length > 0);
  }

  private async findBrokenLinks(allNotes: ReadonlyArray<NotePath>): Promise<BrokenLink[]> {
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const broken: BrokenLink[] = [];

    const basenameSet = new Set<string>();
    for (const np of allNotes) {
      const base = (np as string).split('/').pop()?.replace('.md', '')?.toLowerCase() ?? '';
      if (base) basenameSet.add(base);
    }

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const lines = note.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        let match: RegExpExecArray | null;
        wikiLinkPattern.lastIndex = 0;
        while ((match = wikiLinkPattern.exec(lines[i])) !== null) {
          let target = match[1].trim();
          const hashIdx = target.indexOf('#');
          if (hashIdx !== -1) target = target.substring(0, hashIdx);
          if (!target) continue;

          const targetBasename = target.split('/').pop()?.toLowerCase() ?? '';
          if (basenameSet.has(targetBasename)) continue;

          const normalized = target.endsWith('.md') ? target : `${target}.md`;
          try {
            const targetPath = createNotePath(normalized);
            const exists = await this.vault.exists(targetPath);
            if (!exists) {
              broken.push({ sourcePath: notePath, targetLink: match[1].trim(), lineNumber: i + 1 });
            }
          } catch {
            broken.push({ sourcePath: notePath, targetLink: match[1].trim(), lineNumber: i + 1 });
          }
        }
      }
    }

    return broken;
  }

  private async suggestMissingTags(allNotes: ReadonlyArray<NotePath>): Promise<MissingTagSuggestion[]> {
    const settings = await this.config.getSettings();
    const knownTags = settings.knownTags ?? [];
    if (knownTags.length === 0) return [];

    const keywordToTag = new Map<string, string>();
    for (const tag of knownTags) {
      const stripped = tag.startsWith('#') ? tag.substring(1) : tag;
      const parts = stripped.split('/');
      for (const part of parts) {
        if (part.length >= 4) {
          keywordToTag.set(part.toLowerCase(), tag);
        }
      }
    }

    const suggestions: MissingTagSuggestion[] = [];

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      if (note.metadata.tags.length > 1) continue;

      const contentLower = note.content.toLowerCase();
      const existingTagStrs = new Set(note.metadata.tags.map(t => t as string));
      const matched: string[] = [];

      for (const [keyword, tag] of keywordToTag) {
        if (contentLower.includes(keyword) && !existingTagStrs.has(tag)) {
          matched.push(tag);
        }
      }

      if (matched.length > 0) {
        const uniqueTags = [...new Set(matched)];
        suggestions.push({
          notePath,
          suggestedTags: uniqueTags.map(t => createTagName(t.startsWith('#') ? t : `#${t}`)),
          reason: `Content contains keywords: ${uniqueTags.join(', ')}`,
        });
      }
    }

    return suggestions;
  }
}
