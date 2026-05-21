import * as vscode from 'vscode';
import { ensureSelfIgnored } from '../util/selfIgnore';
import { ProjectIndex } from './index';
import { DependencyGraph } from './graph';

const INDEX_DIR = '.codeup/index';
const INDEX_REL = '.codeup/index/index.json';
const GRAPH_REL = '.codeup/index/graph.json';

export async function saveGraph(root: vscode.Uri, graph: DependencyGraph): Promise<void> {
  const dir = vscode.Uri.joinPath(root, INDEX_DIR);
  await vscode.workspace.fs.createDirectory(dir);
  await ensureSelfIgnored(dir);
  const uri = vscode.Uri.joinPath(root, GRAPH_REL);
  const serializable = {
    edges: Object.fromEntries([...graph.edges].map(([k, v]) => [k, [...v]])),
    unresolvedCount: graph.unresolved.size,
  };
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(serializable, null, 2), 'utf8'));
}

export async function loadIndex(root: vscode.Uri): Promise<ProjectIndex | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, INDEX_REL));
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as ProjectIndex;
  } catch {
    return undefined;
  }
}

export async function saveIndex(root: vscode.Uri, index: ProjectIndex): Promise<void> {
  const dir = vscode.Uri.joinPath(root, INDEX_DIR);
  await vscode.workspace.fs.createDirectory(dir);
  await ensureSelfIgnored(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, INDEX_REL), Buffer.from(JSON.stringify(index, null, 2), 'utf8'));
}
