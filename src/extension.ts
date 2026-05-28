import * as path from 'path';
import * as vscode from 'vscode';
import { AnthropicClient } from './analyzer/client';
import { isSafeRelativePath } from './findings/schema';
import { ProviderFactory } from './analyzer/providerFactory';
import { DecorationManager } from './decorations';
import { DetailsView } from './detailsView';
import { FindingsProvider } from './findingsProvider';
import { suggestIntent } from './intent/suggest';
import { ScanRunner } from './scan/runner';
import { scanWorkspace } from './scanner';
import { buildGraph } from './scanner/graph';
import { StatusBar } from './statusBar';
import { clearApiKey, getApiKey } from './util/apiKey';
import { UpdateChecker } from './util/updateCheck';
import { WorkspaceStores } from './workspaceStores';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Codeup');
  const stores = new WorkspaceStores(output);
  await stores.init();

  const findingsProvider = new FindingsProvider(stores);
  const treeView = vscode.window.createTreeView('codeup.findings', { treeDataProvider: findingsProvider });
  const details = new DetailsView(context, stores);
  const decorations = new DecorationManager(stores);
  const statusBar = new StatusBar(stores);
  const client = new AnthropicClient(context); // kept for the api-key commands + intent suggester
  const providerFactory = new ProviderFactory(context);
  const runner = new ScanRunner(context, stores, providerFactory, statusBar, output);
  const updateChecker = new UpdateChecker(context, context.extension.packageJSON.version as string, output);

  // Fire-and-forget; checkOnActivation is throttled + silent on failure.
  void updateChecker.checkOnActivation();

  context.subscriptions.push(
    output,
    stores,
    treeView,
    decorations,
    statusBar,

    vscode.commands.registerCommand('codeup.findings.refresh', () => findingsProvider.refresh()),
    vscode.commands.registerCommand('codeup.findings.focus', () => treeView.reveal(undefined as never, { focus: true }).then(undefined, () => undefined)),

    vscode.commands.registerCommand('codeup.findings.openFinding', async (id: string) => {
      let finding;
      let owningRoot: vscode.Uri | undefined;
      for (const root of stores.roots) {
        const f = stores.findingsFor(root)?.get(id);
        if (f) { finding = f; owningRoot = root; break; }
      }
      if (!finding || !owningRoot) return;
      details.show(id);
      // Refuse to open files that escape the owning workspace root. This is
      // enforced at schema validation already, but re-check here so the open
      // sink is safe even if a finding bypasses validation.
      if (!isSafeRelativePath(finding.location.file)) {
        vscode.window.showWarningMessage(`Codeup: refusing to open unsafe path: ${finding.location.file}`);
        return;
      }
      const uri = vscode.Uri.joinPath(owningRoot, finding.location.file);
      const rootPath = owningRoot.fsPath + path.sep;
      if (!(uri.fsPath + path.sep).startsWith(rootPath)) {
        vscode.window.showWarningMessage(`Codeup: refusing to open path outside workspace: ${finding.location.file}`);
        return;
      }
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
    vscode.commands.registerCommand('codeup.scan.openTabs', () => {
      const uris = collectOpenTabUris();
      if (uris.length === 0) {
        vscode.window.showWarningMessage('Codeup: no open editor tabs to scan.');
        return;
      }
      return runner.run({ scope: 'files', fileUris: uris });
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

    vscode.commands.registerCommand('codeup.updateCheck.now', () => updateChecker.checkNow()),

    vscode.commands.registerCommand('codeup.intent.suggest', async () => {
      const roots = stores.roots;
      if (roots.length === 0) {
        vscode.window.showWarningMessage('Codeup: open a folder first.');
        return;
      }
      let root = roots[0];
      if (roots.length > 1) {
        const pick = await vscode.window.showQuickPick(
          roots.map((r) => ({ label: r.path.split('/').filter(Boolean).pop() ?? r.path, uri: r })),
          { title: 'Codeup: suggest intent for which workspace folder?' },
        );
        if (!pick) return;
        root = (pick as { uri: vscode.Uri }).uri;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Codeup: drafting intent.yaml',
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const index = await scanWorkspace(root, token);
            if (token.isCancellationRequested) return;
            const graph = buildGraph(index);
            const provider = await providerFactory.resolve();
            output.appendLine(`[intent] provider: ${provider.resolved} (${provider.reason})`);
            const result = await suggestIntent(index, graph, provider.client, token);
            if (token.isCancellationRequested) return;

            const target = vscode.Uri.joinPath(root, '.codeup/intent.yaml');
            let writeUri = target;
            try {
              await vscode.workspace.fs.stat(target);
              const pick = await vscode.window.showWarningMessage(
                'Codeup: .codeup/intent.yaml already exists. Open the proposal as a new untitled file instead?',
                { modal: true },
                'Open as untitled',
              );
              if (pick !== 'Open as untitled') return;
              writeUri = vscode.Uri.parse('untitled:' + target.fsPath + '.proposal');
            } catch {
              // file doesn't exist — write it
              await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, '.codeup'));
              await vscode.workspace.fs.writeFile(target, Buffer.from(result.yaml, 'utf8'));
            }

            if (writeUri.scheme === 'untitled') {
              const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: result.yaml });
              await vscode.window.showTextDocument(doc);
            } else {
              const doc = await vscode.workspace.openTextDocument(target);
              await vscode.window.showTextDocument(doc);
              vscode.window.showInformationMessage(
                `Codeup: wrote ${result.intent.layers.length} layer rule(s) to .codeup/intent.yaml. Review and edit before your next scan.`,
              );
            }
          } catch (err) {
            const name = (err as Error).name;
            if (name === 'AbortError' || token.isCancellationRequested) return;
            vscode.window.showErrorMessage(`Codeup: intent suggestion failed: ${(err as Error).message}`);
          }
        },
      );
    }),
  );
}

export function deactivate(): void {
  // disposables handle cleanup
}

function collectOpenTabUris(): vscode.Uri[] {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        const key = input.uri.toString();
        if (!seen.has(key)) { seen.add(key); out.push(input.uri); }
      }
    }
  }
  return out;
}
