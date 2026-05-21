import * as vscode from 'vscode';
import { AnthropicClient } from './analyzer/client';
import { DecorationManager } from './decorations';
import { DetailsView } from './detailsView';
import { FindingsStore } from './findings/store';
import { FindingsProvider } from './findingsProvider';
import { KnowledgeStore } from './knowledge/store';
import { ScanRunner } from './scan/runner';
import { StatusBar } from './statusBar';
import { clearApiKey, getApiKey } from './util/apiKey';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Codeup');
  const store = new FindingsStore(output);
  const knowledge = new KnowledgeStore(output);
  store.attachKnowledge(knowledge);
  await Promise.all([store.init(), knowledge.init()]);

  const findingsProvider = new FindingsProvider(store);
  const treeView = vscode.window.createTreeView('codeup.findings', { treeDataProvider: findingsProvider });
  const details = new DetailsView(context, store);
  const decorations = new DecorationManager(store);
  const statusBar = new StatusBar(store);
  const client = new AnthropicClient(context);
  const runner = new ScanRunner(context, store, knowledge, client, statusBar, output);

  context.subscriptions.push(
    output,
    store,
    knowledge,
    treeView,
    decorations,
    statusBar,

    vscode.commands.registerCommand('codeup.findings.refresh', () => findingsProvider.refresh()),
    vscode.commands.registerCommand('codeup.findings.focus', () => treeView.reveal(undefined as never, { focus: true }).then(undefined, () => undefined)),

    vscode.commands.registerCommand('codeup.findings.openFinding', async (id: string) => {
      const finding = store.get(id);
      if (!finding) return;
      details.show(id);
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) return;
      const uri = vscode.Uri.joinPath(ws.uri, finding.location.file);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
        if (finding.location.line !== undefined) {
          const line = Math.max(0, finding.location.line - 1);
          const pos = new vscode.Position(line, 0);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(pos, pos);
        }
      } catch (err) {
        vscode.window.showWarningMessage(`Codeup: could not open ${finding.location.file}: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('codeup.findings.groupBy.severity', () => findingsProvider.setGroupBy('severity')),
    vscode.commands.registerCommand('codeup.findings.groupBy.category', () => findingsProvider.setGroupBy('category')),
    vscode.commands.registerCommand('codeup.findings.groupBy.status', () => findingsProvider.setGroupBy('status')),

    vscode.commands.registerCommand('codeup.scan.full', () => runner.run({ scope: 'full' })),
    vscode.commands.registerCommand('codeup.scan.file', () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        vscode.window.showWarningMessage('Codeup: no active editor.');
        return;
      }
      return runner.run({ scope: 'file', fileUri: uri, skipCostPrompt: true });
    }),
    vscode.commands.registerCommand('codeup.apiKey.set', async () => {
      await clearApiKey(context);
      client.reset();
      await getApiKey(context, { prompt: true });
    }),
    vscode.commands.registerCommand('codeup.apiKey.clear', async () => {
      await clearApiKey(context);
      client.reset();
      vscode.window.showInformationMessage('Codeup: API key cleared.');
    }),
  );
}

export function deactivate(): void {
  // disposables handle cleanup
}
