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
  hash: string; // sha256 of source file — used in analysis cache key
}

let cached: Catalogue | undefined;

export function loadCatalogue(extensionDir: string): Catalogue {
  if (cached) return cached;
  const file = path.join(extensionDir, 'resources', 'catalogue', 'default.yaml');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = yaml.load(raw) as { patterns: CataloguePattern[] };
  cached = {
    patterns: parsed.patterns,
    hash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
  };
  return cached;
}

export function patternsForLanguage(cat: Catalogue, language: string): CataloguePattern[] {
  return cat.patterns.filter((p) => p.languages.includes(language));
}
