// Pure helpers extracted from workspaceStores.ts so they can be unit-tested
// without vscode. Operate on string URIs only.

/**
 * Return the root URI strings whose prefix matches `fileUri`, longest first.
 * Empty array if none match.
 */
export function longestPrefixRoot(fileUri: string, roots: readonly string[]): string[] {
  const matched: string[] = [];
  for (const r of roots) {
    const root = r.endsWith('/') ? r : r + '/';
    if (fileUri === r || fileUri.startsWith(root)) matched.push(r);
  }
  return matched.sort((a, b) => b.length - a.length);
}
