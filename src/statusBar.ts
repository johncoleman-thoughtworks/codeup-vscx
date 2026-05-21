import * as vscode from 'vscode';
import { FindingsStore } from './findings/store';

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private scanState = 'idle';

  constructor(private readonly store: FindingsStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'codeup.findings.focus';
    this.disposables.push(this.item, store.onDidChange(() => this.render()));
    this.render();
    this.item.show();
  }

  setScanState(state: 'idle' | 'scanning'): void {
    this.scanState = state;
    this.render();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private render(): void {
    const open = this.store.all.filter((f) => f.status !== 'fixed' && f.status !== 'dismissed');
    const high = open.filter((f) => f.severity === 'high').length;
    const icon = this.scanState === 'scanning' ? '$(sync~spin)' : '$(search)';
    this.item.text = `${icon} Codeup: ${open.length}${high > 0 ? ` ($(error) ${high})` : ''}`;
    this.item.tooltip = `${open.length} open findings • click to open panel`;
  }
}
