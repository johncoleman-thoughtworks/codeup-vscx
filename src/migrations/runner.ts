// Schema migration runner.
//
// Every persisted YAML carries a `schemaVersion: N`. When we bump a schema,
// register a Migration that takes the previous shape and returns the next.
// On read, runMigrations walks `from → from+1 → ... → currentVersion`. If the
// file is at the current version, the runner is a no-op.
//
// Migrations should be PURE: no I/O, no time. The runner is unit-testable in
// plain Node because of that.

export interface Migration<FromShape = unknown, ToShape = unknown> {
  /** Version this migration produces. The runner picks migrations whose
   *  `from = current version of the file`. */
  fromVersion: number;
  /** Same shape: must equal fromVersion + 1. Spelled out for clarity. */
  toVersion: number;
  migrate(prev: FromShape): ToShape;
}

export interface MigrationResult<T> {
  value: T;
  migrated: boolean;       // true if at least one migration step ran
  appliedSteps: number[];  // [2, 3] means we ran v1→v2 then v2→v3
}

export class SchemaTooNewError extends Error {
  constructor(public readonly found: number, public readonly current: number) {
    super(`file schemaVersion ${found} is newer than this build supports (${current})`);
    this.name = 'SchemaTooNewError';
  }
}

export function runMigrations<T>(
  raw: unknown,
  artifactName: string,
  currentVersion: number,
  registry: Migration[],
): MigrationResult<T> {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${artifactName}: cannot migrate, not an object`);
  }
  const r = raw as Record<string, unknown>;
  const found = typeof r.schemaVersion === 'number' ? r.schemaVersion : 1;
  if (found > currentVersion) throw new SchemaTooNewError(found, currentVersion);

  let cur: unknown = raw;
  const appliedSteps: number[] = [];
  for (let v = found; v < currentVersion; v++) {
    const step = registry.find((m) => m.fromVersion === v);
    if (!step) {
      throw new Error(`${artifactName}: no migration registered from v${v} to v${v + 1}`);
    }
    cur = { ...(step.migrate(cur) as object), schemaVersion: step.toVersion };
    appliedSteps.push(step.toVersion);
  }
  return { value: cur as T, migrated: appliedSteps.length > 0, appliedSteps };
}

// Registry constants. Add migrations here when bumping a schema.
//
// Example future migration when finding schema is bumped to v2:
//   FINDING_MIGRATIONS.push({
//     fromVersion: 1, toVersion: 2,
//     migrate: (prev: any) => ({ ...prev, newField: defaultForNewField(prev) }),
//   });

export const FINDING_CURRENT_VERSION = 1;
export const FINDING_MIGRATIONS: Migration[] = [];

export const DISMISSAL_CURRENT_VERSION = 1;
export const DISMISSAL_MIGRATIONS: Migration[] = [];

export const EXEMPLAR_CURRENT_VERSION = 1;
export const EXEMPLAR_MIGRATIONS: Migration[] = [];

export const CUSTOM_PATTERNS_CURRENT_VERSION = 1;
export const CUSTOM_PATTERNS_MIGRATIONS: Migration[] = [];
