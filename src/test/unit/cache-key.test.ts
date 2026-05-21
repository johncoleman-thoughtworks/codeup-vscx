import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analysisCacheKey as key } from '../../analyzer/cacheKey';
const AnalysisCache = { key };

test('AnalysisCache.key: deterministic and includes every component', () => {
  const a = AnalysisCache.key('h1', 'cat1', 'sonnet', 'n1');
  const b = AnalysisCache.key('h1', 'cat1', 'sonnet', 'n1');
  assert.equal(a, b);
});

test('AnalysisCache.key: changes when contentHash changes', () => {
  const a = AnalysisCache.key('h1', 'cat1', 'sonnet', '');
  const b = AnalysisCache.key('h2', 'cat1', 'sonnet', '');
  assert.notEqual(a, b);
});

test('AnalysisCache.key: changes when catalogue hash changes', () => {
  const a = AnalysisCache.key('h1', 'cat1', 'sonnet', '');
  const b = AnalysisCache.key('h1', 'cat2', 'sonnet', '');
  assert.notEqual(a, b);
});

test('AnalysisCache.key: changes when model changes', () => {
  const a = AnalysisCache.key('h1', 'cat1', 'sonnet', '');
  const b = AnalysisCache.key('h1', 'cat1', 'opus', '');
  assert.notEqual(a, b);
});

test('AnalysisCache.key: changes when neighbors+knowledge component changes', () => {
  const a = AnalysisCache.key('h1', 'cat1', 'sonnet', 'n1');
  const b = AnalysisCache.key('h1', 'cat1', 'sonnet', 'n2');
  assert.notEqual(a, b);
});

test('AnalysisCache.key: omitting neighbors yields an empty trailing component', () => {
  assert.match(AnalysisCache.key('h1', 'cat1', 'sonnet'), /h1:cat1:sonnet:$/);
});
