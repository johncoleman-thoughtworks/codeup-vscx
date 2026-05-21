import * as vscode from 'vscode';
import { Catalogue, loadCatalogue, patternsForLanguage } from '../catalogue/loader';
import { FindingsStore } from '../findings/store';
import { AnalysisCache } from '../analyzer/cache';
import { AnthropicClient } from '../analyzer/client';
import { analyzeFile } from '../analyzer/analyze';
import { FileEntry, scanWorkspace } from '../scanner';
import { saveIndex } from '../scanner/persist';
import { StatusBar } from '../statusBar';

const INPUT_COST_PER_MTOK = 3.0;   // approx Sonnet 4.6 list pricing
const OUTPUT_COST_PER_MTOK = 15.0; // assume ~500 output tokens / file analyzed
const CHARS_PER_TOKEN = 3.6;

export interface ScanOptions {
  scope: 'full' | 'file';
  fileUri?: vscode.Uri;
  skipCostPrompt?: boolean;
}

export class ScanRunner {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: FindingsStore,
    private readonly client: AnthropicClient,
    private readonly statusBar: StatusBar,
    private readonly output: vscode.OutputChannel,
  ) {}

  async run(opts: ScanOptions): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      vscode.window.showWarningMessage('Codeup: open a folder first.');
      return;
    }
    const catalogue = loadCatalogue(this.context.extensionPath);
    const cache = new AnalysisCache(root);
    await cache.load();

    const targets = await this.resolveTargets(root, opts, catalogue);
    if (targets.length === 0) {
      vscode.window.showInformationMessage('Codeup: no files to analyze.');
      return;
    }

    const { totalChars, uncached } = await this.preflight(root, targets, catalogue, cache);
    if (!opts.skipCostPrompt && opts.scope === 'full' && uncached.length > 0) {
      const ok = await this.confirmCost(uncached.length, totalChars);
      if (!ok) return;
    }

    this.statusBar.setScanState('scanning');
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: opts.scope === 'full' ? 'Codeup: scanning workspace' : `Codeup: scanning ${opts.fileUri?.path.split('/').pop()}`,
          cancellable: true,
        },
        async (progress, token) => {
          let done = 0;
          for (const entry of targets) {
            if (token.isCancellationRequested) break;
            progress.report({
              message: `${done + 1}/${targets.length} • ${entry.path}`,
              increment: 100 / targets.length,
            });
            try {
              const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, entry.path));
              const result = await analyzeFile(root, entry, bytes, catalogue, this.client, this.store, cache, this.output);
              this.output.appendLine(
                `[scan] ${entry.path}: ${result.findings.length} finding(s)${result.fromCache ? ' (cached)' : ''}${result.skipped ? ` (skipped: ${result.skipped})` : ''}`,
              );
            } catch (err) {
              this.output.appendLine(`[scan] ${entry.path}: ERROR ${(err as Error).message}`);
            }
            done++;
          }
        },
      );
    } finally {
      this.statusBar.setScanState('idle');
    }
  }

  private async resolveTargets(root: vscode.Uri, opts: ScanOptions, catalogue: Catalogue): Promise<FileEntry[]> {
    const index = await scanWorkspace(root);
    await saveIndex(root, index);
    const supported = index.files.filter((f) => patternsForLanguage(catalogue, f.language).length > 0);
    if (opts.scope === 'full') return supported;

    if (!opts.fileUri) return [];
    const rel = vscode.workspace.asRelativePath(opts.fileUri, false);
    return supported.filter((f) => f.path === rel);
  }

  private async preflight(
    root: vscode.Uri,
    targets: FileEntry[],
    catalogue: Catalogue,
    cache: AnalysisCache,
  ): Promise<{ totalChars: number; uncached: FileEntry[] }> {
    const model = this.client.model();
    const uncached: FileEntry[] = [];
    let totalChars = 0;
    for (const t of targets) {
      const key = AnalysisCache.key(t.contentHash, catalogue.hash, model);
      if (cache.get(key)) continue;
      uncached.push(t);
      totalChars += t.size;
    }
    return { totalChars, uncached };
  }

  private async confirmCost(fileCount: number, totalChars: number): Promise<boolean> {
    const inputTokens = totalChars / CHARS_PER_TOKEN;
    const outputTokens = fileCount * 500;
    const cost =
      (inputTokens * INPUT_COST_PER_MTOK) / 1_000_000 +
      (outputTokens * OUTPUT_COST_PER_MTOK) / 1_000_000;
    const msg = `Codeup: scan ${fileCount} files (~${Math.round(inputTokens).toLocaleString()} input tokens). Estimated cost: $${cost.toFixed(2)}. Proceed?`;
    const pick = await vscode.window.showWarningMessage(msg, { modal: true }, 'Proceed');
    return pick === 'Proceed';
  }
}
