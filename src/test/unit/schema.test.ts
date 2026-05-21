import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateFinding } from '../../findings/schema';

function valid(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'sample-1',
    category: 'anemic-domain-model',
    severity: 'high',
    status: 'unconfirmed',
    priority: 'high',
    location: { file: 'src/foo.ts', line: 12 },
    explanation: 'x',
    detectedAt: '2026-01-01T00:00:00Z',
    detectedBy: 'human',
    history: [],
  };
}

test('validateFinding accepts a fully-populated finding', () => {
  const r = validateFinding(valid());
  assert.equal(r.ok, true);
});

test('validateFinding rejects non-object input', () => {
  assert.equal(validateFinding(null).ok, false);
  assert.equal(validateFinding('a string').ok, false);
  assert.equal(validateFinding(42).ok, false);
});

test('validateFinding rejects missing required fields', () => {
  const r = validateFinding({ ...valid(), id: undefined });
  assert.equal(r.ok, false);
});

test('validateFinding rejects invalid severity', () => {
  const r = validateFinding({ ...valid(), severity: 'critical' });
  assert.equal(r.ok, false);
});

test('validateFinding rejects invalid status', () => {
  const r = validateFinding({ ...valid(), status: 'wat' });
  assert.equal(r.ok, false);
});

test('validateFinding accepts missing priority (defaults to medium)', () => {
  const raw: Record<string, unknown> = valid();
  delete raw.priority;
  const r = validateFinding(raw);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.priority, 'medium');
});

test('validateFinding requires a location.file', () => {
  const r = validateFinding({ ...valid(), location: { line: 5 } });
  assert.equal(r.ok, false);
});
