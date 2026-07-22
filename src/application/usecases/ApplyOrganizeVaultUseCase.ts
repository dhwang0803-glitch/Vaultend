import {
  OrganizeVaultPlan,
  OrganizeVaultProposal,
  withPlanStatus,
  getApprovedProposals,
} from '../../domain/models/OrganizeVaultPlan';
import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { OrganizeVaultPort } from '../ports/OrganizeVaultPort';
import { ConfigPort } from '../ports/ConfigPort';
import { createNotePath } from '../../domain/values/NotePath';

export interface ApplyOrganizeVaultResult {
  readonly appliedCount: number;
  readonly failedCount: number;
  readonly historyEntryIds: ReadonlyArray<string>;
  readonly transactionId: string;
}

export class ApplyOrganizeVaultUseCase {
  private txSequence = 0;

  constructor(
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
    private readonly store: OrganizeVaultPort,
    private readonly config: ConfigPort,
  ) {}

  async execute(planId: string): Promise<ApplyOrganizeVaultResult | null> {
    const plan = await this.store.load(planId);
    if (!plan || plan.status !== 'draft') return null;

    const approved = getApprovedProposals(plan);
    if (approved.length === 0) return null;

    const historyEntryIds: string[] = [];
    const appliedProposalIds: string[] = [];
    let failedCount = 0;
    const transactionId = crypto.randomUUID();
    this.txSequence = 0;

    for (const proposal of approved) {
      try {
        const entryIds = await this.applyProposal(proposal, transactionId);
        if (entryIds && entryIds.length > 0) {
          historyEntryIds.push(...entryIds);
          appliedProposalIds.push(proposal.id);
        }
      } catch {
        failedCount++;
        if (historyEntryIds.length > 0) {
          await this.rollbackEntries(historyEntryIds);
          return null;
        }
      }
    }

    for (const proposalId of appliedProposalIds) {
      await this.store.updateProposalStatus(planId, proposalId, 'applied');
    }

    const updated = withPlanStatus(plan, 'applied', this.clock.now());
    const final: OrganizeVaultPlan = { ...updated, transactionId };
    await this.store.save(final);

    return {
      appliedCount: appliedProposalIds.length,
      failedCount,
      historyEntryIds,
      transactionId,
    };
  }

  private async applyProposal(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string[] | null> {
    switch (proposal.type) {
      case 'fix-broken-link':
        return this.wrapSingle(await this.applyFixBrokenLink(proposal, transactionId));
      case 'merge-duplicate-tags':
        return this.wrapSingle(await this.applyMergeDuplicateTags(proposal, transactionId));
      case 'apply-missing-tags':
        return this.wrapSingle(await this.applyMissingTags(proposal, transactionId));
      case 'archive-empty':
        return this.wrapSingle(await this.applyArchive(proposal, transactionId));
      case 'reposition':
      case 'misplaced-reposition':
      case 'promote-note':
        return this.wrapSingle(await this.applyReposition(proposal, transactionId));
      case 'split-folder':
      case 'merge-folders':
        return this.applyBulkReposition(proposal, transactionId);
      case 'merge-duplicate-notes':
        return this.applyMergeDuplicateNotes(proposal, transactionId);
      default:
        return null;
    }
  }

  private wrapSingle(id: string | null): string[] | null {
    return id ? [id] : null;
  }

  private async applyReposition(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string | null> {
    const folderDiff = proposal.diffs.find(d => d.field === 'folder');
    if (!folderDiff) {
      if (proposal.metadata?.source === 'refactor') return null;
      return this.applyArchive(proposal, transactionId);
    }

    const basename = (proposal.targetPath as string).split('/').pop() ?? '';
    const destPath = createNotePath(`${folderDiff.after}/${basename}`);
    await this.vault.moveNote(proposal.targetPath, destPath);

    const tagDiff = proposal.diffs.find(d => d.field === 'tags' && d.before === '(none)');
    if (tagDiff) {
      const newTags = tagDiff.after.split(', ').map(t => t.trim()).filter(Boolean);
      if (newTags.length > 0) {
        const note = await this.vault.readNote(destPath);
        if (note) {
          const existing = note.metadata.tags.map(t => (t as string).toLowerCase());
          const toAdd = newTags.filter(t => !existing.includes(t.toLowerCase()));
          if (toAdd.length > 0) {
            const fmTags = this.extractFrontmatterTags(note.content);
            await this.vault.updateFrontmatter(destPath, { tags: [...fmTags, ...toAdd] });
          }
        }
      }
    }

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'move',
      notePath: proposal.targetPath,
      timestamp: this.clock.now(),
      description: `Organize Vault: moved ${proposal.targetPath as string} → ${folderDiff.after}/`,
      metadata: {
        transactionId,
        organizeVaultProposalId: proposal.id,
        movedTo: destPath as string,
        sequence: this.txSequence++,
      },
    };
    await this.history.record(entry);
    return entry.id;
  }

  private async applyFixBrokenLink(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string | null> {
    const diff = proposal.diffs.find(d => d.field === 'link');
    if (!diff) return null;

    const note = await this.vault.readNote(proposal.targetPath);
    if (!note) return null;

    const brokenLink = diff.before.replace(/^\[\[|\]\]$/g, '');
    const isReplacement = diff.after.startsWith('[[');

    let newContent: string;
    if (isReplacement) {
      const replacement = diff.after;
      const wikiPattern = new RegExp(
        `\\[\\[${this.escapeRegex(brokenLink)}(\\|[^\\]]+)?\\]\\]`,
        'g',
      );
      newContent = note.content.replace(wikiPattern, replacement);
    } else {
      const wikiPattern = new RegExp(
        `\\[\\[${this.escapeRegex(brokenLink)}(\\|[^\\]]+)?\\]\\]`,
        'g',
      );
      newContent = note.content.replace(wikiPattern, brokenLink);
    }

    await this.vault.writeNote(proposal.targetPath, newContent);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'link-remove',
      notePath: proposal.targetPath,
      timestamp: this.clock.now(),
      description: `Organize Vault: broken link fixed — ${diff.before} → ${diff.after}`,
      previousContent: note.content,
      metadata: { transactionId, organizeVaultProposalId: proposal.id, sequence: this.txSequence++ },
    };
    await this.history.record(entry);
    return entry.id;
  }

  private async applyMergeDuplicateTags(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string | null> {
    const diff = proposal.diffs.find(d => d.field === 'tags');
    if (!diff) return null;

    const replaceTags = diff.before.split(', ').map(t => t.trim());
    const keepTag = diff.after.trim();
    const replaceSet = new Set(replaceTags.map(t => t.toLowerCase()));

    let mergedCount = 0;
    for (const notePath of proposal.affectedPaths) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const fmTags = this.extractFrontmatterTags(note.content);
      const updatedTags: string[] = [];
      let changed = false;
      let keepPresent = false;

      for (const t of fmTags) {
        if (replaceSet.has(t.toLowerCase())) {
          changed = true;
          if (!keepPresent) {
            updatedTags.push(keepTag);
            keepPresent = true;
          }
        } else {
          if (t.toLowerCase() === keepTag.toLowerCase()) keepPresent = true;
          updatedTags.push(t);
        }
      }

      if (changed) {
        if (!keepPresent) updatedTags.push(keepTag);
        await this.vault.updateFrontmatter(notePath, { tags: updatedTags });
        mergedCount++;
      }
    }

    if (mergedCount === 0) return null;

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'tag-merge',
      notePath: proposal.targetPath,
      timestamp: this.clock.now(),
      description: `Organize Vault: tags merged — ${replaceTags.join(', ')} → ${keepTag} (${mergedCount} notes)`,
      metadata: { transactionId, organizeVaultProposalId: proposal.id, mergedCount, sequence: this.txSequence++ },
    };
    await this.history.record(entry);
    return entry.id;
  }

  private async applyMissingTags(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string | null> {
    const diff = proposal.diffs.find(d => d.field === 'tags');
    if (!diff) return null;

    const note = await this.vault.readNote(proposal.targetPath);
    if (!note) return null;

    const newTags = diff.after.split(', ').map(t => t.trim());
    const existing = note.metadata.tags.map(t => (t as string).toLowerCase());
    const toAdd = newTags.filter(t => !existing.includes(t.toLowerCase()));
    if (toAdd.length === 0) return null;

    const fmTags = this.extractFrontmatterTags(note.content);
    await this.vault.updateFrontmatter(proposal.targetPath, { tags: [...fmTags, ...toAdd] });

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'tag-add',
      notePath: proposal.targetPath,
      timestamp: this.clock.now(),
      description: `Organize Vault: tags added — ${toAdd.join(', ')}`,
      previousContent: note.content,
      metadata: { transactionId, organizeVaultProposalId: proposal.id, sequence: this.txSequence++ },
    };
    await this.history.record(entry);
    return entry.id;
  }

  private async applyArchive(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string | null> {
    const settings = await this.config.getSettings();
    const archiveFolder = settings.maintenanceArchiveFolder ?? 'Archive';
    const basename = (proposal.targetPath as string).split('/').pop() ?? '';
    const destPath = createNotePath(`${archiveFolder}/${basename}`);
    await this.vault.moveNote(proposal.targetPath, destPath);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      action: 'archive',
      notePath: proposal.targetPath,
      timestamp: this.clock.now(),
      description: `Organize Vault: archived — ${proposal.targetPath as string} → ${archiveFolder}/`,
      metadata: {
        transactionId,
        organizeVaultProposalId: proposal.id,
        archivedTo: destPath as string,
        sequence: this.txSequence++,
      },
    };
    await this.history.record(entry);
    return entry.id;
  }

  private isMergeMetadata(meta: unknown): meta is {
    survivorPath: string;
    donorPath: string;
    mergedContent: string;
    mergedTags: string[];
    sourceBlock: string;
    backlinksToRedirect: string[];
  } {
    if (!meta || typeof meta !== 'object') return false;
    const m = meta as Record<string, unknown>;
    return typeof m.survivorPath === 'string' && m.survivorPath.length > 0
      && typeof m.donorPath === 'string' && m.donorPath.length > 0
      && m.survivorPath !== m.donorPath
      && typeof m.mergedContent === 'string' && m.mergedContent.length > 0
      && Array.isArray(m.mergedTags) && m.mergedTags.every((t: unknown) => typeof t === 'string')
      && typeof m.sourceBlock === 'string'
      && Array.isArray(m.backlinksToRedirect) && m.backlinksToRedirect.every((p: unknown) => typeof p === 'string');
  }

  private async applyMergeDuplicateNotes(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string[] | null> {
    if (!this.isMergeMetadata(proposal.metadata)) return null;
    const meta = proposal.metadata;

    const survivorPath = createNotePath(meta.survivorPath);
    const donorPath = createNotePath(meta.donorPath);
    const entryIds: string[] = [];

    const survivorNote = await this.vault.readNote(survivorPath);
    if (!survivorNote) return null;

    let survivorModified = false;
    const backlinkRestores: Array<{ path: ReturnType<typeof createNotePath>; content: string }> = [];
    let donorArchiveDest: ReturnType<typeof createNotePath> | null = null;

    try {
      const fmMatch = survivorNote.content.match(/^---\n[\s\S]*?\n---\n?/);
      const existingFrontmatter = fmMatch ? fmMatch[0] : '';
      const finalContent = existingFrontmatter + meta.mergedContent + meta.sourceBlock;
      await this.vault.writeNote(survivorPath, finalContent);
      survivorModified = true;

      if (meta.mergedTags.length > 0) {
        await this.vault.updateFrontmatter(survivorPath, { tags: meta.mergedTags });
      }

      const survivorEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        action: 'merge-notes',
        notePath: survivorPath,
        timestamp: this.clock.now(),
        description: `Organize Vault: merged ${meta.donorPath} → ${meta.survivorPath}`,
        previousContent: survivorNote.content,
        metadata: {
          transactionId,
          organizeVaultProposalId: proposal.id,
          donorPath: meta.donorPath,
          sequence: this.txSequence++,
        },
      };
      await this.history.record(survivorEntry);
      entryIds.push(survivorEntry.id);

      const donorBasename = meta.donorPath.split('/').pop()?.replace('.md', '') ?? '';
      const survivorBasename = meta.survivorPath.split('/').pop()?.replace('.md', '') ?? '';

      const linkPattern = new RegExp(
        `(!?)\\[\\[(?:[^\\]|#^]*\\/)?${this.escapeRegex(donorBasename)}(?:\\.md)?((?:#[^\\]|]+|\\^[^\\]|]+)?(?:\\|[^\\]]+)?)\\]\\]`,
        'gi',
      );

      for (const linkingPathStr of meta.backlinksToRedirect) {
        if (linkingPathStr === meta.survivorPath || linkingPathStr === meta.donorPath) continue;

        const linkingPath = createNotePath(linkingPathStr);
        const linkingNote = await this.vault.readNote(linkingPath);
        if (!linkingNote) continue;

        const newContent = linkingNote.content.replace(linkPattern, `$1[[${survivorBasename}$2]]`);

        if (newContent !== linkingNote.content) {
          backlinkRestores.push({ path: linkingPath, content: linkingNote.content });
          await this.vault.writeNote(linkingPath, newContent);

          const backlinkEntry: HistoryEntry = {
            id: crypto.randomUUID(),
            action: 'modify',
            notePath: linkingPath,
            timestamp: this.clock.now(),
            description: `Organize Vault: backlink redirected — [[${donorBasename}]] → [[${survivorBasename}]]`,
            previousContent: linkingNote.content,
            metadata: {
              transactionId,
              organizeVaultProposalId: proposal.id,
              sequence: this.txSequence++,
            },
          };
          await this.history.record(backlinkEntry);
          entryIds.push(backlinkEntry.id);
        }
      }

      const settings = await this.config.getSettings();
      const archiveFolder = settings.maintenanceArchiveFolder ?? 'Archive';
      const donorFileName = meta.donorPath.split('/').pop() ?? '';
      const archiveDest = createNotePath(`${archiveFolder}/${donorFileName}`);
      await this.vault.moveNote(donorPath, archiveDest);
      donorArchiveDest = archiveDest;

      const archiveEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        action: 'archive',
        notePath: donorPath,
        timestamp: this.clock.now(),
        description: `Organize Vault: donor archived — ${meta.donorPath} → ${archiveFolder}/`,
        metadata: {
          transactionId,
          organizeVaultProposalId: proposal.id,
          archivedTo: archiveDest as string,
          sequence: this.txSequence++,
        },
      };
      await this.history.record(archiveEntry);
      entryIds.push(archiveEntry.id);

      return entryIds;
    } catch (err) {
      if (donorArchiveDest) {
        try { await this.vault.moveNote(donorArchiveDest, donorPath); } catch { /* best-effort */ }
      }
      for (let i = backlinkRestores.length - 1; i >= 0; i--) {
        try { await this.vault.writeNote(backlinkRestores[i].path, backlinkRestores[i].content); } catch { /* best-effort */ }
      }
      if (survivorModified) {
        try { await this.vault.writeNote(survivorPath, survivorNote.content); } catch { /* best-effort */ }
      }
      for (let i = entryIds.length - 1; i >= 0; i--) {
        try { await this.history.undo(entryIds[i]); } catch { /* best-effort */ }
      }
      throw err;
    }
  }

  private async applyBulkReposition(
    proposal: OrganizeVaultProposal,
    transactionId: string,
  ): Promise<string[] | null> {
    const entryIds: string[] = [];
    const meta = proposal.metadata as Record<string, unknown> | undefined;

    if (proposal.type === 'split-folder') {
      const subfolders = meta?.suggestedSubfolders as Array<{ name: string; notes: string[] }> | undefined;
      if (!subfolders || subfolders.length === 0) return null;

      for (const sf of subfolders) {
        for (const notePath of sf.notes) {
          const basename = notePath.split('/').pop() ?? '';
          const destPath = createNotePath(`${sf.name}/${basename}`);
          await this.vault.moveNote(createNotePath(notePath), destPath);

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            action: 'move',
            notePath: createNotePath(notePath),
            timestamp: this.clock.now(),
            description: `Organize Vault: split-folder move ${notePath} → ${sf.name}/`,
            metadata: { transactionId, organizeVaultProposalId: proposal.id, movedTo: destPath as string, sequence: this.txSequence++ },
          };
          await this.history.record(entry);
          entryIds.push(entry.id);
        }
      }
    } else if (proposal.type === 'merge-folders') {
      const mergedFolder = meta?.suggestedMergedFolder as string | undefined;
      if (!mergedFolder) return null;

      for (const notePath of proposal.affectedPaths) {
        const basename = (notePath as string).split('/').pop() ?? '';
        const destPath = createNotePath(`${mergedFolder}/${basename}`);
        if (notePath === destPath) continue;
        await this.vault.moveNote(notePath, destPath);

        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          action: 'move',
          notePath,
          timestamp: this.clock.now(),
          description: `Organize Vault: merge-folders move ${notePath as string} → ${mergedFolder}/`,
          metadata: { transactionId, organizeVaultProposalId: proposal.id, movedTo: destPath as string, sequence: this.txSequence++ },
        };
        await this.history.record(entry);
        entryIds.push(entry.id);
      }
    }

    return entryIds.length > 0 ? entryIds : null;
  }

  private async rollbackEntries(entryIds: ReadonlyArray<string>): Promise<void> {
    for (let i = entryIds.length - 1; i >= 0; i--) {
      try {
        await this.history.undo(entryIds[i]);
      } catch {
        // best-effort rollback
      }
    }
  }

  private extractFrontmatterTags(content: string): string[] {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return [];
    const fmBlock = fmMatch[1];
    const tagsMatch = fmBlock.match(/^tags:\s*\[([^\]]*)\]/m)
      ?? fmBlock.match(/^tags:\s*\n((?:\s*-\s*.+\n?)*)/m);
    if (!tagsMatch) return [];

    if (tagsMatch[0].includes('[')) {
      return tagsMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        .map(t => t.startsWith('#') ? t : `#${t}`);
    }
    return tagsMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      .map(t => t.startsWith('#') ? t : `#${t}`);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
