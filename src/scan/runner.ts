import * as vscode from 'vscode';
import { Catalogue, loadCatalogue, patternsForLanguage } from '../catalogue/loader';
import { FindingsStore } from '../findings/store';
import { AnalysisCache } from '../analyzer/cache';
import { AnthropicClient } from '../analyzer/client';
import { analyzeFile, NeighborFile, MAX_NEIGHBORS } from '../analyzer/analyze';
import { FileEntry, scanWorkspace } from '../scanner';
import { saveGraph, saveIndex } from '../scanner/persist';
import { buildGraph, DependencyGraph, findCycles, neighborsOf } from '../scanner/graph';
import { cycleFindings, layerViolations } from '../intent/check';
import { loadIntent } from '../intent/loader';
import { KnowledgeStore } from '../knowledge/store';
import { StatusBar } from '../statusBar';
import { yieldToEventLoop } from '../util/abort';

const INPUT_COST_PER_MTOK = 3.0;
const OUTPUT_COST_PER_MTOK = 15.0;
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
    private readonly knowledge: KnowledgeStore,
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
    const catalogue = loadCatalogue(this.context.extensionPath, this.knowledge.patterns);
    const cache = new AnalysisCache(root);
    await cache.load();

    // 1) Scan workspace + persist index + build graph.
    this.statusBar.setScanState('scanning');
    let index: Awaited<ReturnType<typeof scanWorkspace>>;
    let graph: DependencyGraph;
    try {
      index = await scanWorkspace(root);
      await saveIndex(root, index);
      graph = buildGraph(index);
      await saveGraph(root, graph);
    } finally {
      this.statusBar.setScanState('idle');
    }

    // 2) Rebind findings whose source file moved; orphan the rest.
    const currentFiles = new Map(index.files.map((f) => [f.path, f.contentHash]));
    const rebindStats = await this.store.rebindOrOrphan(currentFiles);
    if (rebindStats.rebound + rebindStats.orphaned > 0) {
      this.output.appendLine(`[scan] rebind: ${rebindStats.rebound} moved, ${rebindStats.orphaned} orphaned`);
    }

    // 3) Deterministic checks — no LLM, no cost.
    const cycles = findCycles(graph);
    for (const f of cycleFindings(cycles)) await this.store.upsertFromAnalysis(f);
    const intent = await loadIntent(root);
    if (intent) {
      for (const f of layerViolations(graph, intent)) await this.store.upsertFromAnalysis(f);
    }
    if (cycles.length > 0 || intent) {
      this.output.appendLine(`[scan] deterministic: ${cycles.length} cycle(s)${intent ? ', layer rules applied' : ''}`);
    }

    // 4) LLM pass — single-file with neighbor context.
    const targets = this.targetsFor(opts, index, catalogue);
    if (targets.length === 0) {
      vscode.window.showInformationMessage('Codeup: no LLM-analyzable files in scope (deterministic checks still ran).');
      return;
    }

    const { totalChars, uncached } = await this.preflight(targets, catalogue, cache, graph, index);
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
              const neighbors = await this.gatherNeighbors(root, entry, graph, index);
              const result = await analyzeFile(
                root, entry, bytes, catalogue, this.client, this.store, cache, this.output, neighbors, this.knowledge, token,
              );
              this.output.appendLine(
                `[scan] ${entry.path}: ${result.findings.length} finding(s)${result.fromCache ? ' (cached)' : ''}${result.skipped ? ` (skipped: ${result.skipped})` : ''}${neighbors.length > 0 ? ` [+${neighbors.length} neighbors]` : ''}`,
              );
            } catch (err) {
              const name = (err as Error).name;
              if (name === 'AbortError' || token.isCancellationRequested) {
                this.output.appendLine(`[scan] ${entry.path}: cancelled`);
                break;
              }
              this.output.appendLine(`[scan] ${entry.path}: ERROR ${(err as Error).message}`);
            }
            done++;
            // Cooperative yield so the extension host drains queued events
            // (tree refreshes, hovers, status-bar repaints) between files.
            await yieldToEventLoop();
          }
        },
      );
    } finally {
      this.statusBar.setScanState('idle');
    }
  }

  private targetsFor(opts: ScanOptions, index: Awaited<ReturnType<typeof scanWorkspace>>, catalogue: Catalogue): FileEntry[] {
    const supported = index.files.filter((f) => patternsForLanguage(catalogue, f.language).length > 0);
    if (opts.scope === 'full') return supported;
    if (!opts.fileUri) return [];
    const rel = vscode.workspace.asRelativePath(opts.fileUri, false);
    return supported.filter((f) => f.path === rel);
  }

  private async gatherNeighbors(
    root: vscode.Uri,
    entry: FileEntry,
    graph: DependencyGraph,
    index: Awaited<ReturnType<typeof scanWorkspace>>,
  ): Promise<NeighborFile[]> {
    const { imports, importedBy } = neighborsOf(graph, entry.path);
    // Interleave so both directions are represented up to the budget.
    const picks: { path: string; relation: 'imports' | 'importedBy' }[] = [];
    const iA = imports.slice(0, MAX_NEIGHBORS);
    const iB = importedBy.slice(0, MAX_NEIGHBORS);
    for (let i = 0; i < MAX_NEIGHBORS && picks.length < MAX_NEIGHBORS; i++) {
      if (i < iA.length) picks.push({ path: iA[i], relation: 'imports' });
      if (i < iB.length && picks.length < MAX_NEIGHBORS) picks.push({ path: iB[i], relation: 'importedBy' });
    }
    const out: NeighborFile[] = [];
    const byPath = new Map(index.files.map((f) => [f.path, f]));
    for (const p of picks) {
      const nEntry = byPath.get(p.path);
      if (!nEntry) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, p.path));
        out.push({ path: p.path, language: nEntry.language, text: Buffer.from(bytes).toString('utf8'), relation: p.relation });
      } catch {
        // skip unreadable
      }
    }
    return out;
  }

  private async preflight(
    targets: FileEntry[],
    catalogue: Catalogue,
    cache: AnalysisCache,
    graph: DependencyGraph,
    index: Awaited<ReturnType<typeof scanWorkspace>>,
  ): Promise<{ totalChars: number; uncached: FileEntry[] }> {
    const model = this.client.model();
    const uncached: FileEntry[] = [];
    let totalChars = 0;
    for (const t of targets) {
      // Estimate without the neighbor hash (cheap approximation).
      const key = AnalysisCache.key(t.contentHash, catalogue.hash, model);
      if (cache.get(key)) continue;
      uncached.push(t);
      totalChars += t.size;
      // Add neighbor budget — same cap as analyzer.
      const { imports, importedBy } = neighborsOf(graph, t.path);
      const neighborPaths = [...imports.slice(0, MAX_NEIGHBORS), ...importedBy.slice(0, MAX_NEIGHBORS)].slice(0, MAX_NEIGHBORS);
      const byPath = new Map(index.files.map((f) => [f.path, f]));
      for (const p of neighborPaths) {
        const n = byPath.get(p);
        if (n) totalChars += Math.min(n.size, 8000);
      }
    }
    return { totalChars, uncached };
  }

  private async confirmCost(fileCount: number, totalChars: number): Promise<boolean> {
    const inputTokens = totalChars / CHARS_PER_TOKEN;
    const outputTokens = fileCount * 500;
    const cost =
      (inputTokens * INPUT_COST_PER_MTOK) / 1_000_000 +
      (outputTokens * OUTPUT_COST_PER_MTOK) / 1_000_000;
    const msg = `Codeup: scan ${fileCount} files (~${Math.round(inputTokens).toLocaleString()} input tokens, neighbors included). Estimated cost: $${cost.toFixed(2)}. Proceed?`;
    const pick = await vscode.window.showWarningMessage(msg, { modal: true }, 'Proceed');
    return pick === 'Proceed';
  }
}
