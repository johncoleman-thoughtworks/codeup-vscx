import * as vscode from 'vscode';
import { Finding, Severity } from './findings/schema';
import { FindingsStore } from './findings/store';

type GroupBy = 'severity' | 'category' | 'status';
type Node = GroupNode | FindingNode;

interface GroupNode {
  kind: 'group';
  label: string;
  children: Finding[];
}

interface FindingNode {
  kind: 'finding';
  finding: Finding;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export class FindingsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groupBy: GroupBy = 'severity';

  constructor(private readonly store: FindingsStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  setGroupBy(g: GroupBy): void {
    this.groupBy = g;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${node.children.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = 'codeup.group';
      return item;
    }
    const f = node.finding;
    const item = new vscode.TreeItem(f.category, vscode.TreeItemCollapsibleState.None);
    item.description = `${f.location.file}${f.location.line ? `:${f.location.line}` : ''}`;
    item.tooltip = f.explanation;
    item.iconPath = severityIcon(f.severity);
    item.contextValue = `codeup.finding.${f.status}`;
    item.command = {
      command: 'codeup.findings.openFinding',
      title: 'Open Finding',
      arguments: [f.id],
    };
    return item;
  }

  getChildren(node?: Node): Node[] {
    const findings = this.store.all.filter((f) => f.status !== 'fixed' && f.status !== 'dismissed');
    if (!node) {
      return this.groupFindings(findings);
    }
    if (node.kind === 'group') {
      return node.children
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        .map((finding) => ({ kind: 'finding', finding }));
    }
    return [];
  }

  private groupFindings(findings: Finding[]): GroupNode[] {
    const orphans = findings.filter((f) => f.location.file.startsWith('__orphan__/'));
    const live = findings.filter((f) => !f.location.file.startsWith('__orphan__/'));

    const groups = new Map<string, Finding[]>();
    for (const f of live) {
      const key = this.groupBy === 'severity' ? f.severity : this.groupBy === 'category' ? f.category : f.status;
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }
    const sortKey = (k: string): string => {
      if (this.groupBy === 'severity') return String(SEVERITY_ORDER[k as Severity] ?? 99);
      return k;
    };
    const result: GroupNode[] = [...groups.entries()]
      .sort(([a], [b]) => sortKey(a).localeCompare(sortKey(b)))
      .map(([label, children]) => ({ kind: 'group', label, children }));
    if (orphans.length > 0) {
      result.push({ kind: 'group', label: 'orphaned', children: orphans });
    }
    return result;
  }
}

function severityIcon(sev: Severity): vscode.ThemeIcon {
  switch (sev) {
    case 'high':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    case 'medium':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
    case 'low':
      return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
  }
}
