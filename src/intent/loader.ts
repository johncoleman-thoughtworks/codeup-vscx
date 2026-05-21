import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { IntentConfig, LayerRule } from './layers';

export { IntentConfig, LayerRule, layerForFile } from './layers';

const INTENT_REL = '.codeup/intent.yaml';

export async function loadIntent(root: vscode.Uri): Promise<IntentConfig | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, INTENT_REL));
    const parsed = yaml.load(Buffer.from(bytes).toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const layers = (parsed as { layers?: LayerRule[] }).layers ?? [];
    if (!Array.isArray(layers)) return undefined;
    return { layers };
  } catch {
    return undefined;
  }
}
