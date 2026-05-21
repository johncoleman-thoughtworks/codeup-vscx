import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mergePatterns, type CataloguePattern } from '../../catalogue/loader';

function p(id: string, hint = 'base', severity: 'low' | 'medium' | 'high' = 'medium'): CataloguePattern {
  return { id, name: id, languages: ['typescript'], defaultSeverity: severity, hint };
}

test('mergePatterns returns base when overrides empty', () => {
  const base = [p('a'), p('b')];
  const merged = mergePatterns(base, []);
  assert.deepEqual(merged.map((m) => m.id).sort(), ['a', 'b']);
});

test('mergePatterns: override replaces pattern with same id', () => {
  const base = [p('a', 'base-hint', 'low')];
  const overrides = [p('a', 'team-hint', 'high')];
  const merged = mergePatterns(base, overrides);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].hint, 'team-hint');
  assert.equal(merged[0].defaultSeverity, 'high');
});

test('mergePatterns: new ids in overrides are appended', () => {
  const merged = mergePatterns([p('a'), p('b')], [p('c')]);
  assert.deepEqual(merged.map((m) => m.id).sort(), ['a', 'b', 'c']);
});
