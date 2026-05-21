import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type { CataloguePattern } from '../catalogue/loader';
import {
  CustomPatternsFile,
  DismissalEntry,
  DismissalsFile,
  ExemplarEntry,
  ExemplarsFile,
} from './schema';

const REL = {
  dir: '.codeup/knowledge',
  dismissals: '.codeup/knowledge/dismissals.yaml',
  exemplars: '.codeup/knowledge/exemplars.yaml',
  patterns: '.codeup/knowledge/patterns.yaml',
};

export class KnowledgeStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private dismissals: DismissalEntry[] = [];
  private exemplars: ExemplarEntry[] = [];
  private customPatterns: CataloguePattern[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposed = false;

  constructor(private readonly output: vscode.OutputChannel) {}

  async init(): Promise<void> {
    await this.reload();
    const root = this.rootUri();
    if (!root) return;
    const pattern = new vscode.RelativePattern(root, '.codeup/knowledge/*.yaml');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate(() => this.reload());
    this.watcher.onDidChange(() => this.reload());
    this.watcher.onDidDelete(() => this.reload());
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }

  get allDismissals(): readonly DismissalEntry[] { return this.dismissals; }
  get allExemplars(): readonly ExemplarEntry[] { return this.exemplars; }
  get patterns(): readonly CataloguePattern[] { return this.customPatterns; }

  /** Hash of the knowledge state — used as part of the analyzer's cache key. */
  hash(): string {
    const blob = JSON.stringify({
      d: this.dismissals.map((e) => ({ c: e.category, p: e.filePathPattern, r: e.rationale })),
      e: this.exemplars.map((e) => ({ c: e.category, f: e.filePath, x: e.excerpt })),
      p: this.customPatterns.map((p) => p.id + ':' + p.hint),
    });
    return crypto.createHash('sha256').update(blob).digest('hex').slice(0, 16);
  }

  async recordDismissal(opts: Omit<DismissalEntry, 'id' | 'schemaVersion' | 'dismissedAt'> & { dismissedAt?: string }): Promise<DismissalEntry> {
    const entry: DismissalEntry = {
      schemaVersion: 1,
      id: stableId('dismissal', `${opts.originalFindingId}:${opts.dismissedBy}`),
      dismissedAt: opts.dismissedAt ?? new Date().toISOString(),
      category: opts.category,
      filePathPattern: opts.filePathPattern,
      rationale: opts.rationale,
      dismissedBy: opts.dismissedBy,
      originalFindingId: opts.originalFindingId,
    };
    this.dismissals = upsertById([...this.dismissals], entry);
    await this.saveDismissals();
    this._onDidChange.fire();
    return entry;
  }

  async recordExemplar(opts: Omit<ExemplarEntry, 'id' | 'schemaVersion' | 'confirmedAt'> & { confirmedAt?: string }): Promise<ExemplarEntry> {
    const entry: ExemplarEntry = {
      schemaVersion: 1,
      id: stableId('exemplar', `${opts.originalFindingId}:${opts.confirmedBy}`),
      confirmedAt: opts.confirmedAt ?? new Date().toISOString(),
      category: opts.category,
      filePath: opts.filePath,
      excerpt: opts.excerpt,
      confirmedBy: opts.confirmedBy,
      originalFindingId: opts.originalFindingId,
    };
    this.exemplars = upsertById([...this.exemplars], entry);
    await this.saveExemplars();
    this._onDidChange.fire();
    return entry;
  }

  private rootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private async reload(): Promise<void> {
    const root = this.rootUri();
    if (!root) return;
    this.dismissals = (await this.readYaml<DismissalsFile>(root, REL.dismissals))?.entries ?? [];
    this.exemplars = (await this.readYaml<ExemplarsFile>(root, REL.exemplars))?.entries ?? [];
    this.customPatterns = (await this.readYaml<CustomPatternsFile>(root, REL.patterns))?.patterns ?? [];
    if (this.disposed) return;
    this._onDidChange.fire();
  }

  private async readYaml<T>(root: vscode.Uri, rel: string): Promise<T | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, rel));
      return yaml.load(Buffer.from(bytes).toString('utf8')) as T;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code !== 'FileNotFound') {
        this.output.appendLine(`[knowledge] ${rel}: ${e.message ?? String(err)}`);
      }
      return undefined;
    }
  }

  private async saveDismissals(): Promise<void> {
    await this.writeYaml<DismissalsFile>(REL.dismissals, { schemaVersion: 1, entries: this.dismissals });
  }

  private async saveExemplars(): Promise<void> {
    await this.writeYaml<ExemplarsFile>(REL.exemplars, { schemaVersion: 1, entries: this.exemplars });
  }

  private async writeYaml<T>(rel: string, content: T): Promise<void> {
    const root = this.rootUri();
    if (!root) return;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, REL.dir));
    const body = yaml.dump(content, { lineWidth: 100, noRefs: true });
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, rel), Buffer.from(body, 'utf8'));
  }
}

function upsertById<T extends { id: string }>(arr: T[], entry: T): T[] {
  const idx = arr.findIndex((e) => e.id === entry.id);
  if (idx === -1) arr.push(entry);
  else arr[idx] = entry;
  return arr;
}

function stableId(kind: string, key: string): string {
  return `${kind}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}
