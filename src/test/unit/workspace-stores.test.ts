import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { longestPrefixRoot } from '../../workspaceStores.pure';

const ROOT_A = 'file:///workspace/project-a';
const ROOT_B = 'file:///workspace/project-b';
const ROOT_A_NESTED = 'file:///workspace/project-a/nested';

test('longestPrefixRoot: single matching root', () => {
  const r = longestPrefixRoot('file:///workspace/project-a/src/foo.ts', [ROOT_A, ROOT_B]);
  assert.deepEqual(r, [ROOT_A]);
});

test('longestPrefixRoot: no match returns empty', () => {
  const r = longestPrefixRoot('file:///somewhere/else.ts', [ROOT_A, ROOT_B]);
  assert.deepEqual(r, []);
});

test('longestPrefixRoot: most-specific (longest) root wins', () => {
  const r = longestPrefixRoot('file:///workspace/project-a/nested/x.ts', [ROOT_A, ROOT_A_NESTED]);
  assert.deepEqual(r, [ROOT_A_NESTED, ROOT_A]);
});

test('longestPrefixRoot: trailing slash on root is tolerated', () => {
  const r = longestPrefixRoot('file:///workspace/project-a/src/foo.ts', [ROOT_A + '/']);
  assert.deepEqual(r, [ROOT_A + '/']);
});

test('longestPrefixRoot: a file path equal to root URI matches', () => {
  const r = longestPrefixRoot(ROOT_A, [ROOT_A]);
  assert.deepEqual(r, [ROOT_A]);
});

test('longestPrefixRoot: avoids spurious string-prefix matches', () => {
  // project-a-clone is NOT inside project-a
  const r = longestPrefixRoot('file:///workspace/project-a-clone/src/foo.ts', [ROOT_A]);
  assert.deepEqual(r, []);
});
