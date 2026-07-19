import { MaintenancePlan, DuplicatePair, BrokenLink, MissingTagSuggestion, OrphanNoteEntry, EmptyNoteEntry, DuplicateTagGroup } from '../../domain/models/OrganizeModels';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import { ConfigPort, PluginSettings } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { ChangeTrackingPort } from '../ports/ChangeTrackingPort';
import { CorpusStatsPort } from '../ports/CorpusStatsPort';
import { TfIdfCorpus } from '../../domain/services/TfIdfCorpus';
import { tokenizeForTfIdf } from '../../domain/services/tokenize';
import { TagNormalizationService, CanonicalTagGroup } from '../../domain/services/TagNormalizationService';
import { FuzzyLinkMatcher } from '../../domain/services/FuzzyLinkMatcher';
import { LinkSuggestionService } from '../../domain/services/LinkSuggestionService';
import type { TagEmbeddingCachePort } from '../ports/TagEmbeddingCachePort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName } from '../../domain/values/TagName';
import { Note } from '../../domain/models/Note';

const NON_TEXT_EXTENSIONS = ['.excalidraw.md', '.canvas'];

export interface MaintenanceScanOptions {
  readonly folder?: string;
}

export class RunMaintenanceUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
    private readonly changeTracking?: ChangeTrackingPort,
    private readonly corpusStats?: CorpusStatsPort,
    private readonly aiProvider?: AIProviderPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
  ) {}

  async execute(options?: MaintenanceScanOptions): Promise<MaintenancePlan> {
    const allNotes = options?.folder
      ? await this.vault.listNotes(options.folder)
      : await this.vault.listNotes();
    const settings = await this.config.getSettings();
    const pathFiltered = this.applyPathExclusions(allNotes, settings);
    const filteredNotes = await this.applyTagExclusion(pathFiltered, settings);
    const now = this.clock.now();

    const canvasRefs = await this.collectCanvasReferences();

    const orphanNotes = await this.findOrphanNotes(filteredNotes, canvasRefs);
    const duplicateCandidates = await this.findDuplicates(filteredNotes);
    const brokenLinks = await this.findBrokenLinks(filteredNotes, allNotes);
    const missingTags = await this.suggestMissingTags(filteredNotes);
    const emptyNotes = await this.findEmptyNotes(filteredNotes);
    const untaggedNotes = await this.findUntaggedNotes(filteredNotes);
    const duplicateTags = await this.findDuplicateTags(filteredNotes);

    if (this.changeTracking) {
      await this.changeTracking.clearAll();
      await this.changeTracking.setLastScanTimestamp(now);
    }

    return {
      orphanNotes,
      duplicateCandidates,
      brokenLinks,
      missingTags,
      emptyNotes,
      untaggedNotes,
      duplicateTags,
      timestamp: now,
    };
  }

  private applyPathExclusions(
    allNotes: ReadonlyArray<NotePath>,
    settings: PluginSettings,
  ): ReadonlyArray<NotePath> {
    const excludeFolders = (settings.maintenanceExcludeFolders ?? [])
      .map(f => f.replace(/\/+$/, ''));
    let filtered = allNotes;

    filtered = filtered.filter(
      np => !NON_TEXT_EXTENSIONS.some(ext => (np as string).toLowerCase().endsWith(ext)),
    );

    if (excludeFolders.length > 0) {
      filtered = filtered.filter(
        np => !excludeFolders.some(folder => (np as string).startsWith(folder + '/')),
      );
    }

    return filtered;
  }

  private async applyTagExclusion(
    notes: ReadonlyArray<NotePath>,
    settings: PluginSettings,
  ): Promise<ReadonlyArray<NotePath>> {
    const excludeTags = new Set(
      (settings.maintenanceExcludeTags ?? []).map(t => t.startsWith('#') ? t : `#${t}`),
    );
    if (excludeTags.size === 0) return notes;
    const result: NotePath[] = [];
    for (const notePath of notes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      const hasExcludedTag = note.metadata.tags.some(t => excludeTags.has(t as string));
      if (!hasExcludedTag) result.push(notePath);
    }
    return result;
  }

  private async collectCanvasReferences(): Promise<Set<string>> {
    const canvasRefs = new Set<string>();
    try {
      const canvasMap = await (this.vault as { getCanvasReferences?(): Promise<Map<string, string[]>> })
        .getCanvasReferences?.();
      if (canvasMap) {
        for (const [, refs] of canvasMap) {
          for (const ref of refs) canvasRefs.add(ref);
        }
      }
    } catch {
      // Adapter does not support canvas — ignore
    }
    return canvasRefs;
  }

  private async findOrphanNotes(
    allNotes: ReadonlyArray<NotePath>,
    canvasRefs: Set<string>,
  ): Promise<OrphanNoteEntry[]> {
    const orphanData: Array<{ notePath: NotePath; fileSize: number; tags: string[]; tokens: string[] }> = [];
    const candidateData: Array<{ path: string; tags: string[]; tokens: string[] }> = [];
    const corpus = new TfIdfCorpus();

    if (this.corpusStats) {
      const saved = await this.corpusStats.loadStats();
      if (saved) corpus.loadFromStats(saved);
    }

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      const tokens = tokenizeForTfIdf(note.content);
      const tags = note.metadata.tags.map(t => t as string);
      corpus.addDocument(notePath as string, tokens);

      candidateData.push({ path: notePath as string, tags, tokens });

      const hasBacklinks = note.metadata.backlinks.length > 0;
      const hasLinks = note.metadata.links.length > 0;
      const referencedByCanvas = canvasRefs.has(notePath as string);
      if (!hasBacklinks && !hasLinks && !referencedByCanvas) {
        orphanData.push({ notePath, fileSize: note.metadata.fileSize, tags, tokens });
      }
    }

    return orphanData.map(orphan => {
      const suggestions = LinkSuggestionService.findRelatedNotes({
        orphanPath: orphan.notePath as string,
        orphanTags: orphan.tags,
        orphanTokens: orphan.tokens,
        candidates: candidateData,
        corpus,
        maxLinks: 5,
      });
      return {
        notePath: orphan.notePath,
        fileSize: orphan.fileSize,
        suggestedLinks: suggestions.length > 0 ? suggestions.map(s => s.path) : undefined,
      };
    });
  }

  private async findEmptyNotes(allNotes: ReadonlyArray<NotePath>): Promise<EmptyNoteEntry[]> {
    const empties: EmptyNoteEntry[] = [];
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      const bodyContent = note.content.replace(/^---[\s\S]*?---\s*/, '').trim();
      if (bodyContent.length === 0) {
        empties.push({
          notePath,
          backlinkCount: note.metadata.backlinks.length,
          backlinkPaths: note.metadata.backlinks,
        });
      }
    }
    return empties;
  }

  private async findUntaggedNotes(allNotes: ReadonlyArray<NotePath>): Promise<NotePath[]> {
    const untagged: NotePath[] = [];
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      const realTags = note.metadata.tags.filter(t => (t as string) !== '#untagged');
      if (realTags.length === 0) {
        untagged.push(notePath);
      }
    }
    return untagged;
  }

  private async findDuplicates(allNotes: ReadonlyArray<NotePath>): Promise<DuplicatePair[]> {
    const candidates = this.generateTitleCandidates(allNotes);

    const corpus = new TfIdfCorpus();
    if (this.corpusStats) {
      const saved = await this.corpusStats.loadStats();
      if (saved) corpus.loadFromStats(saved);
    }

    const noteTokensCache = new Map<string, string[]>();

    const ensureIndexed = async (notePath: NotePath): Promise<string[]> => {
      const pathStr = notePath as string;
      if (noteTokensCache.has(pathStr)) return noteTokensCache.get(pathStr)!;
      const note = await this.vault.readNote(notePath);
      if (!note) return [];
      const tokens = tokenizeForTfIdf(note.content);
      noteTokensCache.set(pathStr, tokens);
      if (corpus.hasDocument(pathStr)) {
        corpus.removeDocument(pathStr);
      }
      corpus.addDocument(pathStr, tokens);
      return tokens;
    };

    const pairs: DuplicatePair[] = [];
    for (const { a, b } of candidates) {
      const tokensA = await ensureIndexed(a);
      const tokensB = await ensureIndexed(b);
      if (tokensA.length === 0 || tokensB.length === 0) continue;

      const vecA = corpus.computeTfIdfVector(tokensA);
      const vecB = corpus.computeTfIdfVector(tokensB);
      const similarity = corpus.cosineSimilarity(vecA, vecB);

      if (similarity >= 0.6) {
        pairs.push({
          noteA: a,
          noteB: b,
          similarityScore: similarity,
          reason: `TF-IDF similarity ${Math.round(similarity * 100)}%`,
        });
      }
    }

    if (this.corpusStats) {
      await this.corpusStats.saveStats(corpus.getStats());
    }

    return pairs.sort((x, y) => y.similarityScore - x.similarityScore);
  }

  private generateTitleCandidates(allNotes: ReadonlyArray<NotePath>): Array<{ a: NotePath; b: NotePath }> {
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

    const results: Array<{ a: NotePath; b: NotePath }> = [];
    for (const [, { a, b, tokensA, tokensB }] of candidateScores) {
      const setB = new Set(tokensB);
      const intersection = tokensA.filter(t => setB.has(t)).length;
      const union = new Set([...tokensA, ...tokensB]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard >= 0.4) {
        results.push({ a, b });
      }
    }

    return results;
  }


  private tokenizeTitle(path: NotePath): string[] {
    const basename = (path as string).split('/').pop()?.replace('.md', '') ?? '';
    return basename.toLowerCase().split(/[\s\-_]+/).filter(t => t.length > 0);
  }

  private async findBrokenLinks(
    scanNotes: ReadonlyArray<NotePath>,
    allVaultNotes: ReadonlyArray<NotePath>,
  ): Promise<BrokenLink[]> {
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const mdLinkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    const externalPattern = /^(https?:\/\/|mailto:|obsidian:\/\/)/i;
    const broken: BrokenLink[] = [];

    const basenameSet = new Set<string>();
    const basenameToPath = new Map<string, NotePath>();
    const fullPathSet = new Set<string>();
    for (const np of allVaultNotes) {
      const pathStr = np as string;
      fullPathSet.add(pathStr.toLowerCase());
      const base = pathStr.split('/').pop()?.replace('.md', '')?.toLowerCase() ?? '';
      if (base) {
        basenameSet.add(base);
        basenameToPath.set(base, np);
      }
    }

    for (const notePath of scanNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const sourceDir = (notePath as string).substring(0, (notePath as string).lastIndexOf('/'));
      const lines = note.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        await this.scanWikiLinks(lines[i], i, wikiLinkPattern, notePath, basenameSet, basenameToPath, broken, note);
        this.collectMarkdownLinkBroken(lines[i], i, mdLinkPattern, externalPattern, notePath, sourceDir, basenameSet, fullPathSet, broken);
      }
    }

    const vaultBasenames = [...basenameSet];
    return broken.map(bl => {
      if (bl.linkType !== 'wiki') return bl;
      const hashIdx = bl.targetLink.indexOf('#');
      const baseTarget = hashIdx !== -1 ? bl.targetLink.substring(0, hashIdx) : bl.targetLink;
      if (!baseTarget) return bl;
      const match = FuzzyLinkMatcher.findBestMatch(baseTarget, vaultBasenames);
      if (!match) return bl;
      return { ...bl, suggestedFix: match.target, fixConfidence: match.score };
    });
  }

  private async scanWikiLinks(
    line: string,
    lineIdx: number,
    pattern: RegExp,
    notePath: NotePath,
    basenameSet: Set<string>,
    basenameToPath: Map<string, NotePath>,
    broken: BrokenLink[],
    note: Note,
  ): Promise<void> {
    pattern.lastIndex = 0;
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) matches.push(m);

    for (const match of matches) {
      const rawTarget = match[1].trim();
      let target = rawTarget;

      const hashIdx = target.indexOf('#');
      const caretIdx = target.indexOf('^');
      const fragmentIdx = hashIdx !== -1 ? hashIdx : (caretIdx !== -1 ? caretIdx : -1);
      const fragment = fragmentIdx !== -1 ? target.substring(fragmentIdx) : null;
      if (fragmentIdx !== -1) target = target.substring(0, fragmentIdx);

      if (!target && fragment) {
        if (!this.fragmentExistsInContent(note.content, fragment)) {
          broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1, linkType: 'wiki' });
        }
        continue;
      }
      if (!target) continue;

      const targetBasename = target.split('/').pop()?.toLowerCase() ?? '';
      if (!basenameSet.has(targetBasename)) {
        const normalized = target.endsWith('.md') ? target : `${target}.md`;
        try {
          const targetPath = createNotePath(normalized);
          const exists = await this.vault.exists(targetPath);
          if (!exists) {
            broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1, linkType: 'wiki' });
          }
        } catch {
          broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1, linkType: 'wiki' });
        }
        continue;
      }

      if (fragment) {
        const resolvedPath = basenameToPath.get(targetBasename);
        if (resolvedPath) {
          const targetNote = await this.vault.readNote(resolvedPath);
          if (targetNote && !this.fragmentExistsInContent(targetNote.content, fragment)) {
            broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1, linkType: 'wiki' });
          }
        }
      }
    }
  }

  private fragmentExistsInContent(content: string, fragment: string): boolean {
    if (fragment.startsWith('#')) {
      const headingText = fragment.substring(1).replace(/-/g, ' ').toLowerCase();
      const headingPattern = /^#{1,6}\s+(.+)/gm;
      let match: RegExpExecArray | null;
      while ((match = headingPattern.exec(content)) !== null) {
        const normalized = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
        if (normalized === headingText) return true;
      }
      return false;
    }
    if (fragment.startsWith('^')) {
      const blockId = fragment.substring(1);
      const blockPattern = new RegExp(`\\^${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
      return blockPattern.test(content);
    }
    return true;
  }

  private collectMarkdownLinkBroken(
    line: string,
    lineIdx: number,
    pattern: RegExp,
    externalPattern: RegExp,
    notePath: NotePath,
    sourceDir: string,
    basenameSet: Set<string>,
    fullPathSet: Set<string>,
    broken: BrokenLink[],
  ): void {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const href = match[2].trim();

      if (externalPattern.test(href)) continue;
      if (href.startsWith('#')) continue;

      let targetPath = href.split('#')[0].split('?')[0];
      if (!targetPath) continue;

      try {
        targetPath = decodeURIComponent(targetPath);
      } catch {
        broken.push({ sourcePath: notePath, targetLink: href, lineNumber: lineIdx + 1, linkType: 'markdown' });
        continue;
      }

      if (!targetPath.startsWith('/') && sourceDir) {
        targetPath = sourceDir + '/' + targetPath;
      }
      targetPath = this.normalizePath(targetPath);

      if (!targetPath.endsWith('.md')) continue;

      if (fullPathSet.has(targetPath.toLowerCase())) continue;

      const targetBasename = targetPath.split('/').pop()?.replace('.md', '')?.toLowerCase() ?? '';
      const hasExplicitPath = targetPath.includes('/');
      if (!hasExplicitPath && basenameSet.has(targetBasename)) continue;

      broken.push({ sourcePath: notePath, targetLink: href, lineNumber: lineIdx + 1, linkType: 'markdown' });
    }
  }

  private normalizePath(path: string): string {
    const parts = path.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') { resolved.pop(); continue; }
      resolved.push(part);
    }
    return resolved.join('/');
  }

  private async suggestMissingTags(allNotes: ReadonlyArray<NotePath>): Promise<MissingTagSuggestion[]> {
    const settings = await this.config.getSettings();
    let tagSource: ReadonlyArray<string> = settings.knownTags ?? [];
    if (tagSource.length === 0) {
      const vaultTags = await this.vault.listAllTags();
      tagSource = vaultTags.filter(t => t.count >= 2).map(t => t.tag);
    }
    if (tagSource.length === 0) return [];

    const keywordToTag = new Map<string, string>();
    for (const tag of tagSource) {
      const stripped = (tag as string).startsWith('#') ? (tag as string).substring(1) : tag as string;
      const parts = stripped.split('/');
      for (const part of parts) {
        if (part.length >= 4) {
          keywordToTag.set(part.toLowerCase(), tag as string);
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

  private async findDuplicateTags(allNotes: ReadonlyArray<NotePath>): Promise<DuplicateTagGroup[]> {
    const tagEntries = await this.vault.listAllTags();
    if (tagEntries.length === 0) return [];

    // 1단계: 문자열 정규화 그룹핑
    const canonicalGroups = TagNormalizationService.buildCanonicalIndex(tagEntries);
    const stringDuplicates = canonicalGroups.filter(g => g.variants.length >= 2);

    // 2단계: 임베딩 유사도 그룹핑 (교차 언어) — 모든 canonical 그룹 비교
    let embeddingDuplicates: CanonicalTagGroup[] = [];
    if (this.aiProvider) {
      embeddingDuplicates = await this.findSimilarByEmbedding(canonicalGroups);
    }

    // 임베딩 그룹에 흡수된 문자열 중복 그룹 제거 (중복 방지)
    const absorbedKeys = new Set(
      embeddingDuplicates.flatMap(g =>
        g.variants.map(v => TagNormalizationService.normalizeForComparison(v.tag)),
      ),
    );
    const unresolvedStringDups = stringDuplicates.filter(
      g => !absorbedKeys.has(g.canonicalKey),
    );
    const allDuplicateGroups = [...unresolvedStringDups, ...embeddingDuplicates];
    if (allDuplicateGroups.length === 0) return [];

    // 노트별 태그 맵 구축 (원본 케이스 보존 — 대소문자 변형 감지에 필수)
    const noteTagMap = new Map<string, ReadonlyArray<string>>();
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (note) {
        noteTagMap.set(notePath as string, note.metadata.tags.map(t => t as string));
      }
    }

    const result: DuplicateTagGroup[] = [];
    for (const group of allDuplicateGroups) {
      const canonicalExact = group.canonical;
      const variantExacts = new Set(group.variants.map(v => v.tag));
      const affected: NotePath[] = [];

      for (const [pathStr, tags] of noteTagMap) {
        const hasNonCanonicalVariant = tags.some(t =>
          variantExacts.has(t) && t !== canonicalExact,
        );
        if (hasNonCanonicalVariant) {
          affected.push(pathStr as NotePath);
        }
      }

      result.push({
        canonicalTag: createTagName(group.canonical),
        variants: group.variants.map(v => ({ tag: createTagName(v.tag), count: v.count })),
        affectedNotes: affected,
      });
    }

    return result;
  }

  private async findSimilarByEmbedding(
    candidateGroups: ReadonlyArray<CanonicalTagGroup>,
  ): Promise<CanonicalTagGroup[]> {
    const MAX_EMBEDDING_TAGS = 500;
    const capped = candidateGroups.slice(0, MAX_EMBEDDING_TAGS);
    if (capped.length < 2 || !this.aiProvider) return [];

    try {
      const tags = capped.map(g => g.canonical);

      const fromCache = this.tagEmbeddingCache?.getMany(tags)
        ?? new Map<string, Float32Array>();
      const missingTags = tags.filter(t => !fromCache.has(t));

      if (missingTags.length > 0) {
        const resp = await this.aiProvider.callEmbedding({ texts: missingTags });
        const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
        for (let i = 0; i < missingTags.length; i++) {
          fromCache.set(missingTags[i], resp.embeddings[i]);
          newEntries.push({ tag: missingTags[i], vector: resp.embeddings[i] });
        }
        this.tagEmbeddingCache?.putMany(newEntries);
      }

      const allEmbeddings = tags.map(t => fromCache.get(t)!);

      const merged = new Set<number>();
      const result: CanonicalTagGroup[] = [];

      for (let i = 0; i < tags.length; i++) {
        if (merged.has(i)) continue;
        const group: Array<{ tag: string; count: number }> = [
          ...capped[i].variants,
        ];
        for (let j = i + 1; j < tags.length; j++) {
          if (merged.has(j)) continue;
          const sim = TagNormalizationService.cosineSimilarity(
            allEmbeddings[i], allEmbeddings[j],
          );
          const threshold = TagNormalizationService.embeddingMergeThreshold(tags[i], tags[j]);
          if (sim >= threshold) {
            group.push(...capped[j].variants);
            merged.add(j);
          }
        }
        if (group.length >= 2) {
          group.sort((a, b) => b.count - a.count);
          result.push({
            canonical: group[0].tag,
            canonicalKey: TagNormalizationService.normalizeForComparison(group[0].tag),
            variants: group,
          });
          merged.add(i);
        }
      }

      this.tagEmbeddingCache?.retainOnly(tags);
      await this.tagEmbeddingCache?.flush();

      return result;
    } catch {
      return [];
    }
  }
}
