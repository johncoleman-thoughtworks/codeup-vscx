import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'qbyte.codeup';

suite('Codeup activation', () => {
  test('extension is present', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  });

  test('extension activates', async function () {
    this.timeout(20_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext!.activate();
    assert.equal(ext!.isActive, true);
  });

  test('codeup.findings.refresh command is registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('codeup.findings.refresh'), 'refresh command missing');
    assert.ok(cmds.includes('codeup.scan.full'), 'scan.full command missing');
    assert.ok(cmds.includes('codeup.scan.file'), 'scan.file command missing');
  });

  test('fixture finding loads from .codeup/findings/', async () => {
    // Give the FileSystemWatcher a moment to settle and pick up the YAML.
    await new Promise((r) => setTimeout(r, 500));
    const root = vscode.workspace.workspaceFolders?.[0];
    assert.ok(root, 'no workspace open');
    const uri = vscode.Uri.joinPath(root!.uri, '.codeup/findings/fixture-1.yaml');
    const bytes = await vscode.workspace.fs.readFile(uri);
    assert.ok(bytes.length > 0, 'fixture YAML not readable');
  });
});
