import { vi } from 'vitest';

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

export class TFile {
  path: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number };
  constructor(path?: string) {
    this.path = path ?? '';
    this.basename = (path ?? '').split('/').pop()?.replace('.md', '') ?? '';
    this.extension = 'md';
    this.stat = { ctime: 1720000000000, mtime: 1720100000000 };
  }
}

export class TFolder {
  path: string;
  constructor(path?: string) { this.path = path ?? ''; }
}

export class App {}
export class Plugin {}
export class Modal {
  app: any;
  contentEl = { empty: vi.fn(), addClass: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
  constructor(app: any) { this.app = app; }
  open() {}
  close() {}
}

export class PluginSettingTab {
  app: any;
  containerEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
  constructor(app: any, _plugin: any) { this.app = app; }
  display() {}
}

export class Setting {
  constructor(_el: any) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addText(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addToggle(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
  addExtraButton(_cb: any) { return this; }
}

export class Notice {
  constructor(_msg: string) {}
}

export class ItemView {
  leaf: any;
  contentEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
  constructor(leaf: any) { this.leaf = leaf; }
  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return ''; }
}

export class WorkspaceLeaf {}

export class TextAreaComponent {
  inputEl = { rows: 0, style: {} as any };
  constructor(_el: any) {}
  setPlaceholder(_p: string) { return this; }
  getValue() { return ''; }
}

export class ButtonComponent {
  constructor(_el: any) {}
  setButtonText(_t: string) { return this; }
  setCta() { return this; }
  onClick(_cb: any) { return this; }
}

export const requestUrl = vi.fn();

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface CachedMetadata {
  frontmatter?: Record<string, any>;
  tags?: Array<{ tag: string }>;
  links?: Array<{ link: string }>;
}
