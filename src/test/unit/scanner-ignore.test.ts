import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import ignore from 'ignore';
import { parseIgnoreText, rewritePatternForScope } from '../../scanner/ignoreLoader';

test('rewritePatternForScope: drops comments and blanks', () => {
  assert.equal(rewritePatternForScope('', ''), undefined);
  assert.equal(rewritePatternForScope('   ', ''), undefined);
  assert.equal(rewritePatternForScope('# a comment', ''), undefined);
});

test('rewritePatternForScope: bare name becomes glob across scope', () => {
  assert.equal(rewritePatternForScope('node_modules', ''), '**/node_modules');
  assert.equal(rewritePatternForScope('node_modules', 'apps/web'), 'apps/web/**/node_modules');
});

test('rewritePatternForScope: anchored (leading /) becomes scope-relative literal', () => {
  assert.equal(rewritePatternForScope('/build', ''), 'build');
  assert.equal(rewritePatternForScope('/build', 'apps/web'), 'apps/web/build');
});

test('rewritePatternForScope: contains slash → anchored to scope', () => {
  assert.equal(rewritePatternForScope('docs/draft', 'apps/web'), 'apps/web/docs/draft');
  assert.equal(rewritePatternForScope('docs/draft/', 'apps/web'), 'apps/web/docs/draft/');
});

test('rewritePatternForScope: glob across scope', () => {
  assert.equal(rewritePatternForScope('*.snap', 'apps/web'), 'apps/web/**/*.snap');
});

test('rewritePatternForScope: negation preserved', () => {
  assert.equal(rewritePatternForScope('!keep.snap', 'apps/web'), '!apps/web/**/keep.snap');
  assert.equal(rewritePatternForScope('!/build', 'apps/web'), '!apps/web/build');
});

test('parseIgnoreText returns ordered list of rewritten patterns', () => {
  const body = '# header\nnode_modules\n!keep.snap\n\n/build/\n';
  assert.deepEqual(parseIgnoreText(body, 'apps/web'), [
    'apps/web/**/node_modules',
    '!apps/web/**/keep.snap',
    'apps/web/build/',
  ]);
});

// ─── End-to-end precedence checks against the real `ignore` library ─────

function buildStack(gitignores: { dir: string; body: string }[], codeupignores: { dir: string; body: string }[]) {
  const gitIg = ignore();
  for (const { dir, body } of gitignores) for (const p of parseIgnoreText(body, dir)) gitIg.add(p);
  const codeupIg = ignore();
  for (const { dir, body } of codeupignores) for (const p of parseIgnoreText(body, dir)) codeupIg.add(p);
  return { gitIg, codeupIg };
}

function decide(stack: ReturnType<typeof buildStack>, p: string): 'kept' | 'skipped' {
  const ci = stack.codeupIg.test(p);
  if (ci.ignored) return 'skipped';
  if (ci.unignored) return 'kept';
  return stack.gitIg.ignores(p) ? 'skipped' : 'kept';
}

test('codeupignore overrides gitignore at same depth via negation', () => {
  const s = buildStack(
    [{ dir: '', body: 'foo.ts' }],
    [{ dir: '', body: '!foo.ts' }],
  );
  assert.equal(decide(s, 'foo.ts'), 'kept');
});

test('shallow codeupignore beats deep gitignore', () => {
  const s = buildStack(
    [{ dir: 'pkg', body: 'foo.ts' }],
    [{ dir: '', body: '!**/foo.ts' }],
  );
  assert.equal(decide(s, 'pkg/foo.ts'), 'kept');
});

test('deep codeupignore beats shallow gitignore-negation', () => {
  const s = buildStack(
    [{ dir: '', body: '!pkg/foo.ts' }],
    [{ dir: 'pkg', body: 'foo.ts' }],
  );
  assert.equal(decide(s, 'pkg/foo.ts'), 'skipped');
});

test('gitignore decides when codeupignore is neutral', () => {
  const s = buildStack(
    [{ dir: '', body: '*.bin' }],
    [{ dir: '', body: '# nothing relevant' }],
  );
  assert.equal(decide(s, 'data/foo.bin'), 'skipped');
});

test('nested codeupignore scopes do not leak across siblings', () => {
  const s = buildStack(
    [],
    [{ dir: 'apps/web', body: 'fixtures' }],
  );
  assert.equal(decide(s, 'apps/web/fixtures/x.ts'), 'skipped');
  assert.equal(decide(s, 'apps/api/fixtures/x.ts'), 'kept');
});
