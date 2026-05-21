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
import { WorkspaceStores } from '../workspaceStores';

const INPUT_COST_PER_MTOK = 3.0;
const OUTPUT_COST_PER_MTOK = 15.0;
const CHARS_PER_TOKEN = 3.6;

export interface ScanOptions {
  scope: 'full' | 'file' | 'files';
  fileUri?: vscode.Uri;        // for 'file'
  fileUris?: vscode.Uri[];     // for 'files'
  skipCostPrompt?: boolean;
}

interface RootContext {
  root: vscode.Uri;
  store: FindingsStore;
  knowledge: KnowledgeStore;
  catalogue: Catalogue;
  cache: AnalysisCache;
  index: Awaited<ReturnType<typeof scanWorkspace>>;
  graph: DependencyGraph;
}

export class ScanRunner {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stores: WorkspaceStores,
    private readonly client: AnthropicClient,
    private readonly statusBar: StatusBar,
    private readonly output: vscode.OutputChannel,
  ) {}

  async run(opts: ScanOptions): Promise<void> {
    const targetRoots = this.resolveScopedRoots(opts);
    if (targetRoots.length === 0) {
      vscode.window.showWarningMessage('Codeup: open a folder first.');
      return;
    }

    // Phase 1: index each root + run deterministic checks. No API cost.
    this.statusBar.setScanState('scanning');
    const contexts: RootContext[] = [];
    try {
      for (const root of targetRoots) {
        const ctx = await this.prepareRoot(root);
        if (ctx) contexts.push(ctx);
      }
    } finally {
      this.statusBar.setScanState('idle');
    }

    // Phase 2: LLM pass, across all contexts.
    const allTargets = contexts.flatMap((ctx) =>
      this.targetsFor(opts, ctx).map((entry) => ({ ctx, entry })),
    );
    if (allTargets.length === 0) {
      vscode.window.showInformationMessage('Codeup: no LLM-analyzable files in scope (deterministic checks still ran).');
      return;
    }

    const { totalChars, uncached } = this.preflight(allTargets);
    const shouldPrompt =
      !opts.skipCostPrompt &&
      uncached.length > 0 &&
      (opts.scope === 'full' || (opts.scope === 'files' && uncached.length > 1));
    if (shouldPrompt) {
      const ok = await this.confirmCost(uncached.length, totalChars);
      if (!ok) return;
    }

    this.statusBar.setScanState('scanning');
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title:
            opts.scope === 'full' ? 'Codeup: scanning workspace' :
            opts.scope === 'files' ? `Codeup: scanning ${opts.fileUris?.length ?? 0} open tab(s)` :
            `Codeup: scanning ${opts.fileUri?.path.split('/').pop()}`,
          cancellable: true,
        },
        async (progress, token) => {
          let done = 0;
          for (const { ctx, entry } of allTargets) {
            if (token.isCancellationRequested) break;
            progress.report({
              message: `${done + 1}/${allTargets.length} • ${entry.path}`,
              increment: 100 / allTargets.length,
            });
            try {
              const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx.root, entry.path));
              const neighbors = await this.gatherNeighbors(ctx, entry);
              const result = await analyzeFile(
                ctx.root, entry, bytes, ctx.catalogue, this.client, ctx.store, ctx.cache, this.output, neighbors, ctx.knowledge, token,
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
            await yieldToEventLoop();
          }
        },
      );
    } finally {
      this.statusBar.setScanState('idle');
    }
  }

  private resolveScopedRoots(opts: ScanOptions): vscode.Uri[] {
    if (opts.scope === 'file' && opts.fileUri) {
      const root = this.stores.rootForFile(opts.fileUri);
      return root ? [root] : [];
    }
    if (opts.scope === 'files' && opts.fileUris) {
      const roots = new Map<string, vscode.Uri>();
      for (const uri of opts.fileUris) {
        const root = this.stores.rootForFile(uri);
        if (root) roots.set(root.toString(), root);
      }
      return [...roots.values()];
    }
    return this.stores.roots;
  }

  private async prepareRoot(root: vscode.Uri): Promise<RootContext | undefined> {
    const store = this.stores.findingsFor(root);
    const knowledge = this.stores.knowledgeFor(root);
    if (!store || !knowledge) return undefined;

    const catalogue = loadCatalogue(this.context.extensionPath, knowledge.patterns);
    const cache = new AnalysisCache(root);
    await cache.load();

    const index = await scanWorkspace(root);
    await saveIndex(root, index);
    const graph = buildGraph(index);
    await saveGraph(root, graph);

    const currentFiles = new Map(index.files.map((f) => [f.path, f.contentHash]));
    const rebindStats = await store.rebindOrOrphan(currentFiles);
    if (rebindStats.rebound + rebindStats.orphaned > 0) {
      this.output.appendLine(`[scan] ${rootLabel(root)}: rebind ${rebindStats.rebound} moved, ${rebindStats.orphaned} orphaned`);
    }

    const cycles = findCycles(graph);
    for (const f of cycleFindings(cycles)) await store.upsertFromAnalysis(f);
    const intent = await loadIntent(root);
    if (intent) {
      for (const f of layerViolations(graph, intent)) await store.upsertFromAnalysis(f);
    }
    if (cycles.length > 0 || intent) {
      this.output.appendLine(`[scan] ${rootLabel(root)}: deterministic ${cycles.length} cycle(s)${intent ? ', layer rules applied' : ''}`);
    }

    return { root, store, knowledge, catalogue, cache, index, graph };
  }

  private targetsFor(opts: ScanOptions, ctx: RootContext): FileEntry[] {
    const supported = ctx.index.files.filter((f) => patternsForLanguage(ctx.catalogue, f.language).length > 0);
    if (opts.scope === 'full') return supported;
    if (opts.scope === 'files' && opts.fileUris) {
      const wanted = new Set<string>();
      for (const uri of opts.fileUris) {
        const owningRoot = this.stores.rootForFile(uri);
        if (!owningRoot || owningRoot.toString() !== ctx.root.toString()) continue;
        // workspace-relative within the owning root
        const rel = uri.path.startsWith(ctx.root.path)
          ? uri.path.slice(ctx.root.path.length).replace(/^\/+/, '')
          : vscode.workspace.asRelativePath(uri, false);
        wanted.add(rel);
      }
      return supported.filter((f) => wanted.has(f.path));
    }
    if (!opts.fileUri) return [];
    const rel = vscode.workspace.asRelativePath(opts.fileUri, false);
    return supported.filter((f) => f.path === rel);
  }

  private async gatherNeighbors(ctx: RootContext, entry: FileEntry): Promise<NeighborFile[]> {
    const { imports, importedBy } = neighborsOf(ctx.graph, entry.path);
    const picks: { path: string; relation: 'imports' | 'importedBy' | 'samePackage' }[] = [];
    const iA = imports.slice(0, MAX_NEIGHBORS);
    const iB = importedBy.slice(0, MAX_NEIGHBORS);
    for (let i = 0; i < MAX_NEIGHBORS && picks.length < MAX_NEIGHBORS; i++) {
      if (i < iA.length) picks.push({ path: iA[i], relation: 'imports' });
      if (i < iB.length && picks.length < MAX_NEIGHBORS) picks.push({ path: iB[i], relation: 'importedBy' });
    }

    // Same-package fallback: many JVM / C# files reference each other in the
    // same package without an explicit import. Without this, inheritance and
    // role-based patterns are invisible to the LLM.
    if (picks.length < MAX_NEIGHBORS) {
      const taken = new Set(picks.map((p) => p.path).concat(entry.path));
      const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      const siblings = ctx.index.files
        .filter((f) => !taken.has(f.path))
        .filter((f) => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '') === dir)
        .filter((f) => f.language === entry.language) // only meaningful for same-language siblings
        .sort((a, b) => a.path.localeCompare(b.path));
      for (const sib of siblings) {
        if (picks.length >= MAX_NEIGHBORS) break;
        picks.push({ path: sib.path, relation: 'samePackage' });
      }
    }

    const out: NeighborFile[] = [];
    const byPath = new Map(ctx.index.files.map((f) => [f.path, f]));
    for (const p of picks) {
      const nEntry = byPath.get(p.path);
      if (!nEntry) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx.root, p.path));
        out.push({ path: p.path, language: nEntry.language, text: Buffer.from(bytes).toString('utf8'), relation: p.relation });
      } catch {
        // skip unreadable
      }
    }
    return out;
  }

  private preflight(targets: { ctx: RootContext; entry: FileEntry }[]): { totalChars: number; uncached: FileEntry[] } {
    const model = this.client.model();
    const uncached: FileEntry[] = [];
    let totalChars = 0;
    for (const { ctx, entry } of targets) {
      const key = AnalysisCache.key(entry.contentHash, ctx.catalogue.hash, model);
      if (ctx.cache.get(key)) continue;
      uncached.push(entry);
      totalChars += entry.size;
      const { imports, importedBy } = neighborsOf(ctx.graph, entry.path);
      const neighborPaths = [...imports.slice(0, MAX_NEIGHBORS), ...importedBy.slice(0, MAX_NEIGHBORS)].slice(0, MAX_NEIGHBORS);
      const byPath = new Map(ctx.index.files.map((f) => [f.path, f]));
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

function rootLabel(root: vscode.Uri): string {
  return root.path.split('/').filter(Boolean).pop() ?? root.path;
}
