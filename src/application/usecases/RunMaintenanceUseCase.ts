import { MaintenancePlan, DuplicatePair, BrokenLink, MissingTagSuggestion, OrphanNoteEntry, EmptyNoteEntry } from '../../domain/models/OrganizeModels';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort } from '../ports/SearchIndexPort';
import { ConfigPort, PluginSettings } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName } from '../../domain/values/TagName';
import { Note } from '../../domain/models/Note';

export interface MaintenanceScanOptions {
  readonly folder?: string;
}

export class RunMaintenanceUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
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

    return {
      orphanNotes,
      duplicateCandidates,
      brokenLinks,
      missingTags,
      emptyNotes,
      untaggedNotes,
      timestamp: now,
    };
  }

  private applyPathExclusions(
    allNotes: ReadonlyArray<NotePath>,
    settings: PluginSettings,
  ): ReadonlyArray<NotePath> {
    const excludeFolders = (settings.maintenanceExcludeFolders ?? [])
      .map(f => f.replace(/\/+$/, ''));
    const excludeFilePatterns = settings.maintenanceExcludeFiles ?? [];

    let filtered = allNotes;

    if (excludeFolders.length > 0) {
      filtered = filtered.filter(
        np => !excludeFolders.some(folder => (np as string).startsWith(folder + '/')),
      );
    }

    if (excludeFilePatterns.length > 0) {
      filtered = filtered.filter(
        np => !excludeFilePatterns.some(pattern => this.matchGlob(np as string, pattern)),
      );
    }

    return filtered;
  }

  private matchGlob(path: string, pattern: string): boolean {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(path);
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
    const orphans: OrphanNoteEntry[] = [];
    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;
      const hasBacklinks = note.metadata.backlinks.length > 0;
      const hasLinks = note.metadata.links.length > 0;
      const referencedByCanvas = canvasRefs.has(notePath as string);
      if (!hasBacklinks && !hasLinks && !referencedByCanvas) {
        orphans.push({ notePath, fileSize: note.metadata.fileSize });
      }
    }
    return orphans;
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

    const pairs: DuplicatePair[] = [];
    for (const { a, b } of candidates) {
      const noteA = await this.vault.readNote(a);
      const noteB = await this.vault.readNote(b);
      if (!noteA || !noteB) continue;

      const contentSim = this.computeContentSimilarity(noteA.content, noteB.content);
      if (contentSim >= 0.7) {
        pairs.push({
          noteA: a,
          noteB: b,
          similarityScore: contentSim,
          reason: `Content similarity ${Math.round(contentSim * 100)}%`,
        });
      }
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

  private computeContentSimilarity(contentA: string, contentB: string): number {
    const trigramsA = this.extractTrigrams(this.stripFrontmatter(contentA));
    const trigramsB = this.extractTrigrams(this.stripFrontmatter(contentB));

    if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

    let intersection = 0;
    for (const trigram of trigramsA) {
      if (trigramsB.has(trigram)) intersection++;
    }

    const union = trigramsA.size + trigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private extractTrigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const trigrams = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
      trigrams.add(normalized.slice(i, i + 3));
    }
    return trigrams;
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\s*/, '').trim();
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

    return broken;
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
          broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1 });
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
            broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1 });
          }
        } catch {
          broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1 });
        }
        continue;
      }

      if (fragment) {
        const resolvedPath = basenameToPath.get(targetBasename);
        if (resolvedPath) {
          const targetNote = await this.vault.readNote(resolvedPath);
          if (targetNote && !this.fragmentExistsInContent(targetNote.content, fragment)) {
            broken.push({ sourcePath: notePath, targetLink: rawTarget, lineNumber: lineIdx + 1 });
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
        broken.push({ sourcePath: notePath, targetLink: href, lineNumber: lineIdx + 1 });
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

      broken.push({ sourcePath: notePath, targetLink: href, lineNumber: lineIdx + 1 });
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
