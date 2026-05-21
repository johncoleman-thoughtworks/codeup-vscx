import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CataloguePattern } from '../../catalogue/loader';
import { neighborsCacheKey, stableId, validateReported } from '../../analyzer/pure';

test('stableId is deterministic', () => {
  const a = stableId('src/foo.ts', 'long-method', 42);
  const b = stableId('src/foo.ts', 'long-method', 42);
  assert.equal(a, b);
});

test('stableId differs when file / category / line differs', () => {
  const base = stableId('src/foo.ts', 'long-method', 42);
  assert.notEqual(stableId('src/bar.ts', 'long-method', 42), base);
  assert.notEqual(stableId('src/foo.ts', 'god-class', 42), base);
  assert.notEqual(stableId('src/foo.ts', 'long-method', 43), base);
});

test('stableId is prefixed by category for readability', () => {
  assert.ok(stableId('a', 'feature-envy', 1).startsWith('feature-envy-'));
});

test('neighborsCacheKey is empty when no neighbors', () => {
  assert.equal(neighborsCacheKey([]), '');
});

test('neighborsCacheKey is order-independent', () => {
  const a = neighborsCacheKey([
    { path: 'a.ts', text: 'X' },
    { path: 'b.ts', text: 'Y' },
  ]);
  const b = neighborsCacheKey([
    { path: 'b.ts', text: 'Y' },
    { path: 'a.ts', text: 'X' },
  ]);
  assert.equal(a, b);
});

test('neighborsCacheKey changes when neighbor content changes', () => {
  const a = neighborsCacheKey([{ path: 'a.ts', text: 'X' }]);
  const b = neighborsCacheKey([{ path: 'a.ts', text: 'Y' }]);
  assert.notEqual(a, b);
});

const patterns: CataloguePattern[] = [
  { id: 'god-class', name: 'God Class', languages: ['typescript'], defaultSeverity: 'high', hint: '' },
];

test('validateReported accepts a well-formed tool input', () => {
  const r = validateReported(
    {
      category: 'god-class',
      severity: 'high',
      line: 7,
      explanation: 'lots',
      confidence: 0.8,
    },
    patterns,
  );
  assert.ok(r);
  assert.equal(r?.category, 'god-class');
});

test('validateReported rejects unknown category', () => {
  const r = validateReported({ category: 'made-up', severity: 'high', line: 1, explanation: 'x', confidence: 1 }, patterns);
  assert.equal(r, undefined);
});

test('validateReported rejects bad severity', () => {
  const r = validateReported({ category: 'god-class', severity: 'extreme', line: 1, explanation: 'x', confidence: 1 }, patterns);
  assert.equal(r, undefined);
});

test('validateReported rejects line < 1', () => {
  const r = validateReported({ category: 'god-class', severity: 'high', line: 0, explanation: 'x', confidence: 1 }, patterns);
  assert.equal(r, undefined);
});

test('validateReported keeps optional endLine when valid', () => {
  const r = validateReported(
    { category: 'god-class', severity: 'high', line: 7, endLine: 12, explanation: 'x', confidence: 0.5 },
    patterns,
  );
  assert.equal(r?.endLine, 12);
});
