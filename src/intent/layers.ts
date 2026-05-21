// Pure layer-matching logic. No vscode / no fs — safe to unit-test in
// plain Node. The I/O wrapper that loads .codeup/intent.yaml lives in
// loader.ts and re-exports these types for ergonomics.

import { minimatch } from 'minimatch';

export interface LayerRule {
  layer: string;
  /**
   * Minimatch glob matched against the workspace-relative file path.
   * Trailing-slash directory patterns (e.g. `src/foo/`) are treated as
   * `src/foo/**` automatically, so simple prefix rules still work the
   * way they always did.
   *
   * Monorepo example:
   *   match: 'packages/* /src/main/java/**\/domain/**'
   */
  match: string;
  cannotDependOn: string[];
}

export interface IntentConfig {
  layers: LayerRule[];
}

export function layerForFile(file: string, intent: IntentConfig): string | undefined {
  // Most-specific match wins (longest pattern). Ties broken by declaration order.
  let best: LayerRule | undefined;
  let bestLen = -1;
  for (const rule of intent.layers) {
    if (!matchesRule(file, rule.match)) continue;
    if (rule.match.length > bestLen) {
      best = rule;
      bestLen = rule.match.length;
    }
  }
  return best?.layer;
}

export function matchesRule(file: string, pattern: string): boolean {
  const effective = normalizePattern(pattern);
  try {
    return minimatch(file, effective, { dot: true });
  } catch {
    return false;
  }
}

function normalizePattern(pattern: string): string {
  // Trailing-slash directory rule → match everything under it.
  if (pattern.endsWith('/')) return pattern + '**';
  return pattern;
}
