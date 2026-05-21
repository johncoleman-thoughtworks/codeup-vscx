import * as vscode from 'vscode';
import { Finding } from './findings/schema';
import { FindingsStore } from './findings/store';
import { KnowledgeStore } from './knowledge/store';
import { longestPrefixRoot } from './workspaceStores.pure';

/**
 * One FindingsStore + KnowledgeStore per VS Code workspace folder.
 *
 * State lives per-root on disk under each root's `.codeup/` so each project's
 * findings travel with that project's repo. The UI gets a merged view via
 * the aggregated accessors here.
 */
export class WorkspaceStores {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly findings = new Map<string, FindingsStore>();
  private readonly knowledge = new Map<string, KnowledgeStore>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly output: vscode.OutputChannel) {}

  async init(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      await this.add(folder.uri);
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
        for (const removed of e.removed) this.remove(removed.uri);
        for (const added of e.added) await this.add(added.uri);
        this._onDidChange.fire();
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const s of this.findings.values()) s.dispose();
    for (const s of this.knowledge.values()) s.dispose();
    this._onDidChange.dispose();
  }

  /** All findings across every root, with root URI attached. */
  get allFindingsWithRoot(): { finding: Finding; root: vscode.Uri }[] {
    const out: { finding: Finding; root: vscode.Uri }[] = [];
    for (const store of this.findings.values()) {
      for (const f of store.all) out.push({ finding: f, root: store.rootUri });
    }
    return out;
  }

  get roots(): vscode.Uri[] {
    return [...this.findings.values()].map((s) => s.rootUri);
  }

  findingsFor(root: vscode.Uri): FindingsStore | undefined {
    return this.findings.get(root.toString());
  }

  knowledgeFor(root: vscode.Uri): KnowledgeStore | undefined {
    return this.knowledge.get(root.toString());
  }

  /** Which workspace folder does this file belong to? Longest-prefix match. */
  rootForFile(fileUri: vscode.Uri): vscode.Uri | undefined {
    return longestPrefixRoot(fileUri.toString(), this.roots.map((r) => r.toString()))
      .map((s) => vscode.Uri.parse(s))[0];
  }

  private async add(root: vscode.Uri): Promise<void> {
    const key = root.toString();
    if (this.findings.has(key)) return;
    const knowledge = new KnowledgeStore(root, this.output);
    const findings = new FindingsStore(root, this.output);
    findings.attachKnowledge(knowledge);
    await Promise.all([findings.init(), knowledge.init()]);
    findings.onDidChange(() => this._onDidChange.fire());
    knowledge.onDidChange(() => this._onDidChange.fire());
    this.findings.set(key, findings);
    this.knowledge.set(key, knowledge);
    this._onDidChange.fire();
  }

  private remove(root: vscode.Uri): void {
    const key = root.toString();
    this.findings.get(key)?.dispose();
    this.knowledge.get(key)?.dispose();
    this.findings.delete(key);
    this.knowledge.delete(key);
  }
}
