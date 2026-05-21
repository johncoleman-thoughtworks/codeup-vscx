import * as vscode from 'vscode';

const BODY = `# Codeup-generated state. Safe to delete; will be regenerated on next scan.\n*\n!.gitignore\n`;

/**
 * Drop a local .gitignore inside a generated directory so its contents are
 * ignored by git even if the user hasn't added a project-level entry. Idempotent.
 */
export async function ensureSelfIgnored(dir: vscode.Uri): Promise<void> {
  const gi = vscode.Uri.joinPath(dir, '.gitignore');
  try {
    await vscode.workspace.fs.stat(gi);
    return;
  } catch {
    // not present — write it
  }
  try {
    await vscode.workspace.fs.writeFile(gi, Buffer.from(BODY, 'utf8'));
  } catch {
    // best-effort; never block scanning on this
  }
}
