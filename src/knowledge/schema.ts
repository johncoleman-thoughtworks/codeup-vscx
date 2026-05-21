// Knowledge entries persisted under .codeup/knowledge/. The schema is
// intentionally simple — category + glob pattern + free-text rationale.
// Vector similarity / dense retrieval can come later via the same shape.

import type { CataloguePattern } from '../catalogue/loader';

export interface DismissalEntry {
  schemaVersion: 1;
  id: string;
  category: string;
  filePathPattern: string; // minimatch glob, defaults to the original file path
  rationale: string;
  dismissedAt: string;
  dismissedBy: string;
  originalFindingId: string;
}

export interface ExemplarEntry {
  schemaVersion: 1;
  id: string;
  category: string;
  filePath: string;
  excerpt: string; // explanation snippet from the confirmed finding
  confirmedAt: string;
  confirmedBy: string;
  originalFindingId: string;
}

export interface DismissalsFile {
  schemaVersion: 1;
  entries: DismissalEntry[];
}

export interface ExemplarsFile {
  schemaVersion: 1;
  entries: ExemplarEntry[];
}

export interface CustomPatternsFile {
  schemaVersion: 1;
  patterns: CataloguePattern[];
}
