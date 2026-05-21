import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type { KnowledgeStore } from '../knowledge/store';
import { FINDING_CURRENT_VERSION, FINDING_MIGRATIONS, runMigrations } from '../migrations/runner';
import { Finding, HistoryEvent, Priority, Severity, Status, validateFinding } from './schema';

function severityToPriority(s: Severity): Priority {
  return s;
}

function isInternalPath(filePath: string): boolean {
  return filePath === '.codeup' || filePath.startsWith('.codeup/');
}

export class FindingsStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private findings = new Map<string, Finding>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposed = false;

  private knowledge: KnowledgeStore | undefined;

  constructor(private readonly root: vscode.Uri, private readonly output: vscode.OutputChannel) {}

  get rootUri(): vscode.Uri { return this.root; }

  attachKnowledge(knowledge: KnowledgeStore): void {
    this.knowledge = knowledge;
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }

  get all(): Finding[] {
    return [...this.findings.values()];
  }

  get(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  async init(): Promise<void> {
    const dir = this.findingsDirUri();
    await this.reloadAll();

    const pattern = new vscode.RelativePattern(dir, '*.yaml');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate(() => this.reloadAll());
    this.watcher.onDidChange(() => this.reloadAll());
    this.watcher.onDidDelete(() => this.reloadAll());
  }

  private findingsDirUri(): vscode.Uri {
    const cfg = vscode.workspace.getConfiguration('codeup');
    const rel = cfg.get<string>('findingsDir', '.codeup/findings');
    return vscode.Uri.joinPath(this.root, rel);
  }

  private async reloadAll(): Promise<void> {
    const dir = this.findingsDirUri();
    const next = new Map<string, Finding>();
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      for (const [name, kind] of entries) {
        if (kind !== vscode.FileType.File) continue;
        if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
        const uri = vscode.Uri.joinPath(dir, name);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const parsed = yaml.load(Buffer.from(bytes).toString('utf8'));
          let migrated: unknown;
          try {
            const mig = runMigrations(parsed, name, FINDING_CURRENT_VERSION, FINDING_MIGRATIONS);
            migrated = mig.value;
            if (mig.migrated) {
              this.output.appendLine(`[findings] ${name}: migrated through v${mig.appliedSteps.join(', v')}`);
            }
          } catch (err) {
            this.output.appendLine(`[findings] ${name}: ${(err as Error).message}`);
            continue;
          }
          const result = validateFinding(migrated);
          if (!result.ok) {
            this.output.appendLine(
              `[findings] ${name}: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
            );
            continue;
          }
          // Belt-and-braces: never surface findings pointing at Codeup's own
          // state. These can survive from earlier scans before .codeup was
          // excluded from the workspace walker.
          if (isInternalPath(result.value.location.file)) {
            this.output.appendLine(`[findings] ${name}: skipped — points at internal path ${result.value.location.file}`);
            continue;
          }
          next.set(result.value.id, result.value);
        } catch (err) {
          this.output.appendLine(`[findings] ${name}: ${(err as Error).message}`);
        }
      }
    } catch {
      // dir does not exist yet — fine
    }
    if (this.disposed) return;
    this.findings = next;
    this._onDidChange.fire();
  }

  async save(finding: Finding): Promise<void> {
    const dir = this.findingsDirUri();
    await vscode.workspace.fs.createDirectory(dir);
    const uri = vscode.Uri.joinPath(dir, `${finding.id}.yaml`);
    const body = yaml.dump(finding, { lineWidth: 100, noRefs: true });
    await vscode.workspace.fs.writeFile(uri, Buffer.from(body, 'utf8'));
    this.findings.set(finding.id, finding);
    this._onDidChange.fire();
  }

  async updateStatus(id: string, status: Status, note?: string): Promise<void> {
    const f = this.findings.get(id);
    if (!f) return;
    if (f.status === status) return; // no-op — don't record dismissed→dismissed
    const event: HistoryEvent = {
      timestamp: new Date().toISOString(),
      event: 'status_changed',
      from: f.status,
      to: status,
      note,
    };
    await this.save({ ...f, status, history: [...f.history, event] });

    if (this.knowledge) {
      try {
        if (status === 'dismissed' && note) {
          await this.knowledge.recordDismissal({
            category: f.category,
            filePathPattern: f.location.file,
            rationale: note,
            dismissedBy: 'developer',
            originalFindingId: f.id,
          });
        } else if (status === 'confirmed') {
          await this.knowledge.recordExemplar({
            category: f.category,
            filePath: f.location.file,
            excerpt: f.explanation,
            confirmedBy: 'developer',
            originalFindingId: f.id,
          });
        }
      } catch (err) {
        this.output.appendLine(`[findings] knowledge capture failed: ${(err as Error).message}`);
      }
    }
  }

  async upsertFromAnalysis(partial: Omit<Finding, 'history' | 'status' | 'priority' | 'schemaVersion'> & {
    status?: Status;
    priority?: Priority;
  }): Promise<Finding> {
    const existing = this.findings.get(partial.id);
    if (existing) {
      const next: Finding = {
        ...existing,
        category: partial.category,
        severity: partial.severity,
        location: partial.location,
        explanation: partial.explanation,
        suggestedRemediation: partial.suggestedRemediation,
        detectedAt: existing.detectedAt,
        detectedBy: partial.detectedBy,
        confidence: partial.confidence,
      };
      await this.save(next);
      return next;
    }
    const finding: Finding = {
      schemaVersion: 1,
      id: partial.id,
      category: partial.category,
      severity: partial.severity,
      status: partial.status ?? 'unconfirmed',
      priority: partial.priority ?? severityToPriority(partial.severity),
      location: partial.location,
      explanation: partial.explanation,
      suggestedRemediation: partial.suggestedRemediation,
      detectedAt: partial.detectedAt,
      detectedBy: partial.detectedBy,
      confidence: partial.confidence,
      history: [{ timestamp: partial.detectedAt, event: 'detected' }],
    };
    await this.save(finding);
    return finding;
  }

  async rebindOrOrphan(currentFiles: Map<string, string>): Promise<{ rebound: number; orphaned: number }> {
    let rebound = 0;
    let orphaned = 0;
    for (const f of [...this.findings.values()]) {
      const exists = currentFiles.has(f.location.file);
      if (exists) continue;
      // Try content-hash match — file probably moved.
      const fromHash = f.location.contentHash;
      let target: string | undefined;
      if (fromHash) {
        for (const [path, hash] of currentFiles) if (hash === fromHash) { target = path; break; }
      }
      if (target) {
        const event: HistoryEvent = {
          timestamp: new Date().toISOString(),
          event: 'rebound',
          from: f.location.file,
          to: target,
        };
        await this.save({
          ...f,
          location: { ...f.location, file: target },
          history: [...f.history, event],
        });
        rebound++;
      } else if (!f.location.file.startsWith('__orphan__/')) {
        const event: HistoryEvent = {
          timestamp: new Date().toISOString(),
          event: 'rebound',
          from: f.location.file,
          to: `__orphan__/${f.location.file}`,
          note: 'source file no longer present and no content-hash match found',
        };
        await this.save({
          ...f,
          location: { ...f.location, file: `__orphan__/${f.location.file}` },
          history: [...f.history, event],
        });
        orphaned++;
      }
    }
    return { rebound, orphaned };
  }

  async updatePriority(id: string, priority: Priority): Promise<void> {
    const f = this.findings.get(id);
    if (!f) return;
    const event: HistoryEvent = {
      timestamp: new Date().toISOString(),
      event: 'priority_changed',
      from: f.priority,
      to: priority,
    };
    await this.save({ ...f, priority, history: [...f.history, event] });
  }
}
