import 'obsidian';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'vaultend:history-changed', callback: (undoneId?: string) => void): EventRef;
    trigger(name: 'vaultend:history-changed', undoneId?: string): void;
  }
}
