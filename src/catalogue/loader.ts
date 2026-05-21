import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface CataloguePattern {
  id: string;
  name: string;
  languages: string[];
  defaultSeverity: 'low' | 'medium' | 'high';
  hint: string;
}

export interface Catalogue {
  patterns: CataloguePattern[];
  hash: string;
}

let defaultRaw: string | undefined;
let defaultPatterns: CataloguePattern[] | undefined;

/** Load the default catalogue + merge any workspace overrides on top. */
export function loadCatalogue(extensionDir: string, workspaceOverrides: readonly CataloguePattern[] = []): Catalogue {
  if (!defaultRaw || !defaultPatterns) {
    const file = path.join(extensionDir, 'resources', 'catalogue', 'default.yaml');
    defaultRaw = fs.readFileSync(file, 'utf8');
    defaultPatterns = (yaml.load(defaultRaw) as { patterns: CataloguePattern[] }).patterns;
  }

  const merged = mergePatterns(defaultPatterns, workspaceOverrides);
  const overrideBlob = workspaceOverrides.length === 0
    ? ''
    : JSON.stringify(workspaceOverrides.map((p) => ({ id: p.id, hint: p.hint, sev: p.defaultSeverity, langs: p.languages })));
  const hash = crypto.createHash('sha256').update(defaultRaw + '|' + overrideBlob).digest('hex').slice(0, 16);
  return { patterns: merged, hash };
}

export function mergePatterns(base: readonly CataloguePattern[], overrides: readonly CataloguePattern[]): CataloguePattern[] {
  if (overrides.length === 0) return [...base];
  const byId = new Map<string, CataloguePattern>(base.map((p) => [p.id, p]));
  for (const o of overrides) byId.set(o.id, o);
  return [...byId.values()];
}

export function patternsForLanguage(cat: Catalogue, language: string): CataloguePattern[] {
  return cat.patterns.filter((p) => p.languages.includes(language));
}
