// Pure helpers for rewriting gitignore-style patterns from a nested
// ignore file so they apply relative to the workspace root. Splitting
// these out keeps the logic unit-testable without a VS Code host.

/**
 * Rewrite a single pattern from an ignore file located at directory
 * `scopeDir` (workspace-relative, POSIX, no trailing slash; empty for
 * the workspace root) so it can be added to a root-level Ignore
 * instance and still mean the same thing.
 *
 * Returns undefined for comments and blank lines.
 */
export function rewritePatternForScope(rawLine: string, scopeDir: string): string | undefined {
  const line = rawLine.replace(/\r$/, '');
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith('#')) return undefined;

  let negated = false;
  let body = trimmed;
  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1);
  }
  // Escaped leading hash / bang per gitignore spec.
  if (body.startsWith('\\#') || body.startsWith('\\!')) {
    body = body.slice(1);
  }

  // Strip a leading `/` — gitignore treats it as "anchored to this
  // ignore file's directory," which after rewrite is equivalent to
  // anchoring at scopeDir directly.
  let anchored = false;
  if (body.startsWith('/')) {
    anchored = true;
    body = body.slice(1);
  }

  // A pattern containing a `/` anywhere except trailing is also
  // anchored to the ignore file's directory.
  const trailingSlash = body.endsWith('/');
  const bodyForSlashCheck = trailingSlash ? body.slice(0, -1) : body;
  if (!anchored && bodyForSlashCheck.includes('/')) {
    anchored = true;
  }

  const prefix = scopeDir.length > 0 ? `${scopeDir}/` : '';
  const rewritten = anchored ? `${prefix}${body}` : `${prefix}**/${body}`;
  return negated ? `!${rewritten}` : rewritten;
}

/**
 * Parse the textual body of a .gitignore / .codeupignore file located
 * at `scopeDir` into a list of root-relative patterns ready to feed
 * to ignore().add().
 */
export function parseIgnoreText(text: string, scopeDir: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const rewritten = rewritePatternForScope(line, scopeDir);
    if (rewritten !== undefined) out.push(rewritten);
  }
  return out;
}
