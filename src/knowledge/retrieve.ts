// Pure retrieval. No vscode / no fs — unit-testable in plain Node.

import * as path from 'path';
import { minimatch } from 'minimatch';
import type { DismissalEntry, ExemplarEntry } from './schema';

export const MAX_DISMISSALS = 3;
export const MAX_EXEMPLARS = 3;

export interface KnowledgeSnapshot {
  dismissals: readonly DismissalEntry[];
  exemplars: readonly ExemplarEntry[];
}

export interface RelevantKnowledge {
  dismissals: DismissalEntry[];
  exemplars: ExemplarEntry[];
}

/**
 * Find dismissal and exemplar entries relevant to analyzing `filePath`.
 *
 * Dismissals match when the entry's filePathPattern matches the path.
 * Exemplars match by directory proximity — same dir > same package > anywhere.
 *
 * Caller decides which categories to surface; this function returns
 * everything relevant to the file regardless of category.
 */
export function relevantFor(filePath: string, snapshot: KnowledgeSnapshot): RelevantKnowledge {
  const dismissals: DismissalEntry[] = [];
  for (const d of snapshot.dismissals) {
    if (matchesGlob(filePath, d.filePathPattern)) dismissals.push(d);
  }

  const fileDir = path.posix.dirname(filePath);
  const exemplars = [...snapshot.exemplars]
    .map((e) => ({ e, score: directoryProximity(fileDir, path.posix.dirname(e.filePath)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ e }) => e);

  return {
    dismissals: dedupeByCategory(dismissals, MAX_DISMISSALS),
    exemplars: dedupeByCategory(exemplars, MAX_EXEMPLARS),
  };
}

/**
 * Format the retrieved knowledge as a system-prompt fragment. Stays empty
 * when there is nothing to inject so we don't waste tokens.
 */
export function formatForPrompt(k: RelevantKnowledge): string {
  if (k.dismissals.length === 0 && k.exemplars.length === 0) return '';
  const lines: string[] = ['', 'Project conventions (from this team\'s prior dismissals and confirmations):'];
  if (k.dismissals.length > 0) {
    lines.push('', 'Patterns previously dismissed as not-applicable in this project:');
    for (const d of k.dismissals) {
      const rat = d.rationale.replace(/\s+/g, ' ').trim();
      lines.push(`- ${d.category} (files matching \`${d.filePathPattern}\`): ${rat}`);
    }
    lines.push(
      'Take these dismissals seriously — if the case in front of you matches the dismissed pattern\'s situation, do not report it. If your case is meaningfully different, report it but acknowledge the prior dismissal in your explanation.',
    );
  }
  if (k.exemplars.length > 0) {
    lines.push('', 'Patterns confirmed as real instances in this project (use as positive examples):');
    for (const e of k.exemplars) {
      const ex = e.excerpt.replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- ${e.category} confirmed in ${e.filePath}: ${ex}`);
    }
  }
  return lines.join('\n');
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  if (pattern === filePath) return true;
  try {
    return minimatch(filePath, pattern, { dot: true, nocase: false });
  } catch {
    return false;
  }
}

function directoryProximity(a: string, b: string): number {
  if (a === b) return 100;
  const aSegs = a.split('/');
  const bSegs = b.split('/');
  let shared = 0;
  for (let i = 0; i < Math.min(aSegs.length, bSegs.length); i++) {
    if (aSegs[i] === bSegs[i]) shared++;
    else break;
  }
  return shared * 10;
}

function dedupeByCategory<T extends { category: string }>(arr: T[], cap: number): T[] {
  const out: T[] = [];
  const seen = new Map<string, number>();
  for (const item of arr) {
    const count = seen.get(item.category) ?? 0;
    if (count >= cap) continue;
    out.push(item);
    seen.set(item.category, count + 1);
  }
  return out;
}
