// Pure layer-matching logic. No vscode / no fs — safe to unit-test in
// plain Node. The I/O wrapper that loads .codeup/intent.yaml lives in
// loader.ts and re-exports these types for ergonomics.

export interface LayerRule {
  layer: string;
  match: string;
  cannotDependOn: string[];
}

export interface IntentConfig {
  layers: LayerRule[];
}

export function layerForFile(file: string, intent: IntentConfig): string | undefined {
  // Most-specific (longest prefix) wins.
  let best: LayerRule | undefined;
  for (const rule of intent.layers) {
    if (file.startsWith(rule.match) && (best === undefined || rule.match.length > best.match.length)) {
      best = rule;
    }
  }
  return best?.layer;
}
