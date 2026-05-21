import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { DismissalEntry, ExemplarEntry } from '../../knowledge/schema';
import { formatForPrompt, matchesGlob, relevantFor } from '../../knowledge/retrieve';

function dismissal(category: string, filePathPattern: string, rationale: string): DismissalEntry {
  return {
    schemaVersion: 1,
    id: `d-${category}-${filePathPattern}`,
    category,
    filePathPattern,
    rationale,
    dismissedAt: '2026-01-01T00:00:00Z',
    dismissedBy: 'tester',
    originalFindingId: 'f-1',
  };
}

function exemplar(category: string, filePath: string, excerpt: string): ExemplarEntry {
  return {
    schemaVersion: 1,
    id: `e-${category}-${filePath}`,
    category,
    filePath,
    excerpt,
    confirmedAt: '2026-01-01T00:00:00Z',
    confirmedBy: 'tester',
    originalFindingId: 'f-1',
  };
}

test('matchesGlob: exact path matches', () => {
  assert.equal(matchesGlob('src/foo.ts', 'src/foo.ts'), true);
});

test('matchesGlob: ** wildcard', () => {
  assert.equal(matchesGlob('src/test/x/y/z.test.ts', 'src/test/**'), true);
  assert.equal(matchesGlob('src/test/x.ts', 'src/test/**'), true);
  assert.equal(matchesGlob('src/main/x.ts', 'src/test/**'), false);
});

test('matchesGlob: * wildcard does not cross directories', () => {
  assert.equal(matchesGlob('src/foo.ts', 'src/*.ts'), true);
  assert.equal(matchesGlob('src/a/foo.ts', 'src/*.ts'), false);
});

test('relevantFor: dismissals filtered by glob', () => {
  const r = relevantFor('src/test/foo.test.ts', {
    dismissals: [
      dismissal('long-method', 'src/test/**', 'tests are allowed long methods'),
      dismissal('long-method', 'src/main/**', 'irrelevant'),
    ],
    exemplars: [],
  });
  assert.equal(r.dismissals.length, 1);
  assert.equal(r.dismissals[0].rationale, 'tests are allowed long methods');
});

test('relevantFor: exemplars ranked by directory proximity', () => {
  const r = relevantFor('src/domain/order/Order.java', {
    dismissals: [],
    exemplars: [
      exemplar('anemic-domain-model', 'src/unrelated/X.java', 'far'),
      exemplar('anemic-domain-model', 'src/domain/order/OrderItem.java', 'same dir'),
      exemplar('anemic-domain-model', 'src/domain/customer/Customer.java', 'sibling'),
    ],
  });
  assert.equal(r.exemplars[0].excerpt, 'same dir');
});

test('relevantFor: caps per-category entries', () => {
  const dismissals: DismissalEntry[] = [];
  for (let i = 0; i < 10; i++) {
    dismissals.push(dismissal('long-method', '**', `r${i}`));
  }
  const r = relevantFor('src/x.ts', { dismissals, exemplars: [] });
  assert.equal(r.dismissals.length, 3);
});

test('formatForPrompt: empty input yields empty string', () => {
  assert.equal(formatForPrompt({ dismissals: [], exemplars: [] }), '');
});

test('formatForPrompt: includes both blocks when populated', () => {
  const out = formatForPrompt({
    dismissals: [dismissal('long-method', 'src/test/**', 'tests can be long')],
    exemplars: [exemplar('anemic-domain-model', 'src/domain/X.java', 'classic case')],
  });
  assert.match(out, /Patterns previously dismissed/);
  assert.match(out, /tests can be long/);
  assert.match(out, /Patterns confirmed as real instances/);
  assert.match(out, /classic case/);
});
