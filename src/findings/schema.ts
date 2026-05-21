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
