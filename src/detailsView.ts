import * as vscode from 'vscode';
import { Finding, Priority, Status } from './findings/schema';
import { FindingsStore } from './findings/store';
import { WorkspaceStores } from './workspaceStores';

export class DetailsView {
  private panel: vscode.WebviewPanel | undefined;
  private currentId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stores: WorkspaceStores,
  ) {
    stores.onDidChange(() => {
      if (this.currentId) this.render(this.currentId);
    });
  }

  private findStoreFor(id: string): { store: FindingsStore; finding: Finding } | undefined {
    for (const root of this.stores.roots) {
      const store = this.stores.findingsFor(root);
      const f = store?.get(id);
      if (store && f) return { store, finding: f };
    }
    return undefined;
  }

  show(id: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'codeup.findingDetails',
        'Codeup Finding',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentId = undefined;
      });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    }
    this.currentId = id;
    this.render(id);
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private async onMessage(msg: { type: string; status?: Status; priority?: Priority; note?: string }): Promise<void> {
    if (!this.currentId) return;
    const located = this.findStoreFor(this.currentId);
    if (!located) return;
    const { store } = located;
    switch (msg.type) {
      case 'confirm':
        await store.updateStatus(this.currentId, 'confirmed');
        break;
      case 'dismiss': {
        const note = await vscode.window.showInputBox({
          prompt: 'Why is this being dismissed? (saved to the knowledge base)',
        });
        await store.updateStatus(this.currentId, 'dismissed', note);
        break;
      }
      case 'fixed':
        await store.updateStatus(this.currentId, 'fixed');
        break;
      case 'reopen':
        await store.updateStatus(this.currentId, 'unconfirmed', 'reopened');
        break;
      case 'setStatus':
        if (msg.status) await store.updateStatus(this.currentId, msg.status, msg.note);
        break;
      case 'setPriority':
        if (msg.priority) await store.updatePriority(this.currentId, msg.priority);
        break;
      case 'open':
        vscode.commands.executeCommand('codeup.findings.openFinding', this.currentId);
        break;
    }
  }

  private render(id: string): void {
    if (!this.panel) return;
    const located = this.findStoreFor(id);
    if (!located) {
      this.panel.webview.html = `<html><body><p>Finding not found.</p></body></html>`;
      return;
    }
    const f = located.finding;
    this.panel.title = `${f.category} — ${f.location.file}`;
    this.panel.webview.html = this.html(f);
  }

  private html(f: Finding): string {
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const md = (s: string): string => esc(s).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>');
    const historyRows = f.history
      .map(
        (h) =>
          `<tr><td>${esc(h.timestamp)}</td><td>${esc(h.event)}</td><td>${esc([h.from, h.to].filter(Boolean).join(' → '))}</td><td>${esc(h.note ?? '')}</td></tr>`,
      )
      .join('');
    return renderHtml(f, esc, md, historyRows);
  }
}

function actionButtons(status: Status): string {
  switch (status) {
    case 'unconfirmed':
      return `
        <button onclick="send('confirm')">Confirm</button>
        <button onclick="send('dismiss')">Dismiss…</button>
        <button onclick="send('fixed')">Mark Fixed</button>`;
    case 'confirmed':
      return `
        <button onclick="send('dismiss')">Dismiss…</button>
        <button onclick="send('fixed')">Mark Fixed</button>
        <button onclick="send('reopen')">Reopen</button>`;
    case 'dismissed':
      return `
        <span class="resolved">✓ Dismissed — see history below for rationale.</span>
        <button onclick="send('reopen')">Reopen</button>`;
    case 'fixed':
      return `
        <span class="resolved">✓ Marked fixed.</span>
        <button onclick="send('reopen')">Reopen</button>`;
  }
}

function renderHtml(
  f: Finding,
  esc: (s: string) => string,
  md: (s: string) => string,
  historyRows: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
  h1 { font-size: 1.2rem; margin: 0 0 0.5rem 0; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85rem; margin-bottom: 1rem; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; margin-right: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .actions { margin: 1rem 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .resolved { color: var(--vscode-descriptionForeground); font-style: italic; margin-right: 0.5rem; }
  button { margin-right: 0.5rem; padding: 4px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  h2 { font-size: 1rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  td, th { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
</style></head><body>
  <h1>${esc(f.category)}</h1>
  <div class="meta">
    <span class="badge">${esc(f.severity)}</span>
    <span class="badge">${esc(f.status)}</span>
    <span class="badge">priority: ${esc(f.priority)}</span>
    <span>${esc(f.location.file)}${f.location.line ? `:${f.location.line}` : ''}</span>
  </div>
  <div class="actions">
    <button onclick="send('open')">Open Code</button>
    ${actionButtons(f.status)}
  </div>
  <h2>Explanation</h2>
  <p>${md(f.explanation)}</p>
  ${f.suggestedRemediation ? `<h2>Suggested remediation</h2><p>${md(f.suggestedRemediation)}</p>` : ''}
  <h2>History</h2>
  <table><thead><tr><th>When</th><th>Event</th><th>Change</th><th>Note</th></tr></thead><tbody>${historyRows}</tbody></table>
  <script>
    const vscode = acquireVsCodeApi();
    function send(type) { vscode.postMessage({ type }); }
  </script>
</body></html>`;
}
