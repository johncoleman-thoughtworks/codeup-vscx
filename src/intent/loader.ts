import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

export interface LayerRule {
  layer: string;          // human-readable layer name (e.g. "domain")
  match: string;          // path prefix or simple glob ("src/main/java/com/x/domain/")
  cannotDependOn: string[]; // layer names this layer must not import from
}

export interface IntentConfig {
  layers: LayerRule[];
}

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

export function layerForFile(file: string, intent: IntentConfig): string | undefined {
  // Pick the most specific matching layer (longest prefix wins).
  let best: LayerRule | undefined;
  for (const rule of intent.layers) {
    if (file.startsWith(rule.match) && (best === undefined || rule.match.length > best.match.length)) {
      best = rule;
    }
  }
  return best?.layer;
}
