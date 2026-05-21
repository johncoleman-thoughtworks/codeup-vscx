import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Migration, runMigrations, SchemaTooNewError } from '../../migrations/runner';

test('runMigrations: no-op when file is at current version', () => {
  const result = runMigrations<{ schemaVersion: number; x: number }>(
    { schemaVersion: 3, x: 1 },
    'thing',
    3,
    [],
  );
  assert.equal(result.migrated, false);
  assert.deepEqual(result.appliedSteps, []);
  assert.equal(result.value.x, 1);
});

test('runMigrations: runs one step v1 → v2', () => {
  const migs: Migration[] = [
    { fromVersion: 1, toVersion: 2, migrate: (prev: any) => ({ ...prev, newField: 'default' }) },
  ];
  const result = runMigrations<{ schemaVersion: number; legacy: string; newField: string }>(
    { schemaVersion: 1, legacy: 'a' },
    'thing',
    2,
    migs,
  );
  assert.equal(result.migrated, true);
  assert.deepEqual(result.appliedSteps, [2]);
  assert.equal(result.value.schemaVersion, 2);
  assert.equal(result.value.newField, 'default');
  assert.equal(result.value.legacy, 'a');
});

test('runMigrations: chains v1 → v2 → v3', () => {
  const migs: Migration[] = [
    { fromVersion: 1, toVersion: 2, migrate: (prev: any) => ({ ...prev, b: prev.a + 1 }) },
    { fromVersion: 2, toVersion: 3, migrate: (prev: any) => ({ ...prev, c: prev.b + 1 }) },
  ];
  const result = runMigrations<any>({ schemaVersion: 1, a: 1 }, 'thing', 3, migs);
  assert.deepEqual(result.appliedSteps, [2, 3]);
  assert.equal(result.value.a, 1);
  assert.equal(result.value.b, 2);
  assert.equal(result.value.c, 3);
  assert.equal(result.value.schemaVersion, 3);
});

test('runMigrations: throws when a step is missing', () => {
  assert.throws(
    () => runMigrations({ schemaVersion: 1 }, 'thing', 3, [
      { fromVersion: 2, toVersion: 3, migrate: (p: any) => p },
    ]),
    /no migration registered from v1 to v2/,
  );
});

test('runMigrations: throws SchemaTooNewError when file is newer than this build', () => {
  assert.throws(
    () => runMigrations({ schemaVersion: 9 }, 'thing', 3, []),
    SchemaTooNewError,
  );
});

test('runMigrations: defaults to schemaVersion 1 when field absent', () => {
  const migs: Migration[] = [
    { fromVersion: 1, toVersion: 2, migrate: (prev: any) => ({ ...prev, bumped: true }) },
  ];
  const result = runMigrations<any>({ a: 1 }, 'thing', 2, migs);
  assert.equal(result.value.bumped, true);
});

test('runMigrations: rejects non-object input', () => {
  assert.throws(() => runMigrations(null, 'thing', 1, []), /not an object/);
});
