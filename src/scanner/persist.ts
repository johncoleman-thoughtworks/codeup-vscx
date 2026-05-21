import * as vscode from 'vscode';
import { ProjectIndex } from './index';

const INDEX_REL = '.codeup/index/index.json';

export async function loadIndex(root: vscode.Uri): Promise<ProjectIndex | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, INDEX_REL));
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as ProjectIndex;
  } catch {
    return undefined;
  }
}

export async function saveIndex(root: vscode.Uri, index: ProjectIndex): Promise<void> {
  const uri = vscode.Uri.joinPath(root, INDEX_REL);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, '.codeup/index'));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(index, null, 2), 'utf8'));
}
