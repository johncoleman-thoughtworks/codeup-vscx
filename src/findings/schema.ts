export type Severity = 'low' | 'medium' | 'high';
export type Status = 'unconfirmed' | 'confirmed' | 'dismissed' | 'fixed';
export type Priority = 'ignore' | 'low' | 'medium' | 'high';

export interface FindingLocation {
  file: string;
  line?: number;
  endLine?: number;
  astPath?: string;
  contentHash?: string;
}

export interface HistoryEvent {
  timestamp: string;
  event: 'detected' | 'status_changed' | 'priority_changed' | 'note' | 'rebound';
  by?: string;
  from?: string;
  to?: string;
  note?: string;
}

export interface Finding {
  schemaVersion: 1;
  id: string;
  category: string;
  severity: Severity;
  status: Status;
  priority: Priority;
  location: FindingLocation;
  explanation: string;
  suggestedRemediation?: string;
  detectedAt: string;
  detectedBy: string;
  confidence?: number;
  history: HistoryEvent[];
}

export interface ValidationError {
  path: string;
  message: string;
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high'];
const STATUSES: Status[] = ['unconfirmed', 'confirmed', 'dismissed', 'fixed'];
const PRIORITIES: Priority[] = ['ignore', 'low', 'medium', 'high'];

export function validateFinding(raw: unknown): { ok: true; value: Finding } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const push = (path: string, message: string) => errors.push({ path, message });

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: [{ path: '$', message: 'finding must be an object' }] };
  }
  const r = raw as Record<string, unknown>;

  const schemaVersion = r.schemaVersion ?? 1;
  if (schemaVersion !== 1) push('schemaVersion', `unsupported schemaVersion: ${String(schemaVersion)}`);

  const id = str(r.id, 'id', push);
  if (id && !isSafeIdentifier(id)) {
    push('id', 'must match [A-Za-z0-9_.-]{1,128} and contain no path separators');
  }
  const category = str(r.category, 'category', push);
  const severity = enumOf(r.severity, SEVERITIES, 'severity', push);
  const status = enumOf(r.status, STATUSES, 'status', push);
  const priority = enumOf(r.priority ?? 'medium', PRIORITIES, 'priority', push);
  const explanation = str(r.explanation, 'explanation', push);
  const detectedAt = str(r.detectedAt ?? new Date().toISOString(), 'detectedAt', push);
  const detectedBy = str(r.detectedBy ?? 'human', 'detectedBy', push);

  const loc = r.location as Record<string, unknown> | undefined;
  if (!loc || typeof loc !== 'object') {
    push('location', 'missing location object');
  }
  const file = loc ? str(loc.file, 'location.file', push) : '';
  if (file && !isSafeRelativePath(file)) {
    push('location.file', 'must be a workspace-relative POSIX path with no ".." segments, drive letters, or backslashes');
  }
  const line = loc?.line === undefined ? undefined : num(loc.line, 'location.line', push);
  const endLine = loc?.endLine === undefined ? undefined : num(loc.endLine, 'location.endLine', push);

  const history = Array.isArray(r.history) ? (r.history as HistoryEvent[]) : [];

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      id,
      category,
      severity: severity!,
      status: status!,
      priority: priority!,
      location: {
        file,
        line,
        endLine,
        astPath: loc?.astPath as string | undefined,
        contentHash: loc?.contentHash as string | undefined,
      },
      explanation,
      suggestedRemediation: r.suggestedRemediation as string | undefined,
      detectedAt,
      detectedBy,
      confidence: r.confidence === undefined ? undefined : Number(r.confidence),
      history,
    },
  };
}

export function isSafeIdentifier(id: string): boolean {
  return /^[A-Za-z0-9_.-]{1,128}$/.test(id) && id !== '.' && id !== '..';
}

// Acceptable: POSIX-relative paths like "src/foo.ts" or "__orphan__/x".
// Rejected: absolute paths, drive letters, backslashes, any ".." segment.
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > 1024) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  if (p.includes('\\')) return false;
  if (p.includes('\0')) return false;
  for (const seg of p.split('/')) {
    if (seg === '..') return false;
  }
  return true;
}

function str(v: unknown, path: string, push: (p: string, m: string) => void): string {
  if (typeof v !== 'string' || v.length === 0) {
    push(path, 'must be a non-empty string');
    return '';
  }
  return v;
}

function num(v: unknown, path: string, push: (p: string, m: string) => void): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    push(path, 'must be a number');
    return 0;
  }
  return n;
}

function enumOf<T extends string>(v: unknown, allowed: T[], path: string, push: (p: string, m: string) => void): T | undefined {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    push(path, `must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return v as T;
}
