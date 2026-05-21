// Pure helpers extracted from analyzer/analyze.ts so they can be unit-tested
// in plain Node. analyze.ts imports vscode at runtime, which makes the rest
// untestable without a VS Code host.

import * as crypto from 'crypto';
import type { CataloguePattern } from '../catalogue/loader';
import { ReportedFinding } from './tools';

export function stableId(file: string, category: string, line: number): string {
  const h = crypto.createHash('sha1').update(`${file}:${category}:${line}`).digest('hex').slice(0, 12);
  return `${category}-${h}`;
}

export function neighborsCacheKey(neighbors: { path: string; text: string }[]): string {
  if (neighbors.length === 0) return '';
  const sorted = [...neighbors].sort((a, b) => a.path.localeCompare(b.path));
  const blob = sorted
    .map((n) => `${n.path}@${crypto.createHash('sha256').update(n.text).digest('hex').slice(0, 16)}`)
    .join('|');
  return crypto.createHash('sha256').update(blob).digest('hex').slice(0, 16);
}

export function validateReported(input: unknown, patterns: CataloguePattern[]): ReportedFinding | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const r = input as Record<string, unknown>;
  const category = String(r.category ?? '');
  if (!patterns.some((p) => p.id === category)) return undefined;
  const severity = r.severity;
  if (severity !== 'low' && severity !== 'medium' && severity !== 'high') return undefined;
  const line = Number(r.line);
  if (!Number.isFinite(line) || line < 1) return undefined;
  const endLine = r.endLine === undefined ? undefined : Number(r.endLine);
  const explanation = String(r.explanation ?? '');
  if (!explanation) return undefined;
  const confidence = Number(r.confidence ?? 0);
  if (!Number.isFinite(confidence)) return undefined;
  return {
    category,
    severity,
    line,
    endLine: endLine && Number.isFinite(endLine) ? endLine : undefined,
    explanation,
    suggestedRemediation: r.suggestedRemediation ? String(r.suggestedRemediation) : undefined,
    confidence,
  };
}
