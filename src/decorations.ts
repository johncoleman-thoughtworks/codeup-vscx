import * as vscode from 'vscode';
import { Finding, Severity } from './findings/schema';
import { FindingsStore } from './findings/store';

export class DecorationManager {
  private readonly decorationTypes: Record<Severity, vscode.TextEditorDecorationType>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: FindingsStore) {
    this.decorationTypes = {
      high: vscode.window.createTextEditorDecorationType({
        gutterIconPath: undefined,
        overviewRulerColor: new vscode.ThemeColor('errorForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        backgroundColor: new vscode.ThemeColor('inputValidation.errorBackground'),
        isWholeLine: true,
      }),
      medium: vscode.window.createTextEditorDecorationType({
        overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        backgroundColor: new vscode.ThemeColor('inputValidation.warningBackground'),
        isWholeLine: true,
      }),
      low: vscode.window.createTextEditorDecorationType({
        overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        backgroundColor: new vscode.ThemeColor('inputValidation.infoBackground'),
        isWholeLine: true,
      }),
    };

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.applyToActive()),
      vscode.workspace.onDidOpenTextDocument(() => this.applyToActive()),
      store.onDidChange(() => this.applyAll()),
    );
    this.applyAll();
  }

  dispose(): void {
    for (const d of Object.values(this.decorationTypes)) d.dispose();
    for (const d of this.disposables) d.dispose();
  }

  findingsForDocument(doc: vscode.TextDocument): Finding[] {
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!ws) return [];
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    return this.store.all.filter((f) => f.status !== 'fixed' && f.status !== 'dismissed' && f.location.file === rel);
  }

  private applyAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.applyTo(editor);
  }

  private applyToActive(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) this.applyTo(editor);
  }

  private applyTo(editor: vscode.TextEditor): void {
    const findings = this.findingsForDocument(editor.document);
    const buckets: Record<Severity, vscode.DecorationOptions[]> = { high: [], medium: [], low: [] };
    for (const f of findings) {
      const line = Math.max(0, (f.location.line ?? 1) - 1);
      const endLine = Math.max(line, (f.location.endLine ?? f.location.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, endLine, Number.MAX_SAFE_INTEGER);
      const md = new vscode.MarkdownString(
        `**${f.category}** — _${f.severity}_\n\n${f.explanation}\n\n[Open finding](command:codeup.findings.openFinding?${encodeURIComponent(JSON.stringify(f.id))})`,
      );
      md.isTrusted = true;
      buckets[f.severity].push({ range, hoverMessage: md });
    }
    for (const sev of ['high', 'medium', 'low'] as Severity[]) {
      editor.setDecorations(this.decorationTypes[sev], buckets[sev]);
    }
  }
}
