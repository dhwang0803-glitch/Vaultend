import { App, FuzzySuggestModal, TFolder } from 'obsidian';
import { t } from '../i18n';

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private readonly folders: TFolder[];

  constructor(
    app: App,
    private readonly onChoose: (folder: TFolder) => void,
  ) {
    super(app);
    this.setPlaceholder(t('organizeFolder.placeholder'));
    this.folders = this.collectFolders();
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/ (Vault Root)';
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }

  private collectFolders(): TFolder[] {
    const folders: TFolder[] = [];
    const recurse = (folder: TFolder): void => {
      folders.push(folder);
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          recurse(child);
        }
      }
    };
    recurse(this.app.vault.getRoot());
    return folders;
  }
}
