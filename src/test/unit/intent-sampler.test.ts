import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { FileEntry, ProjectIndex } from '../../scanner';
import type { DependencyGraph } from '../../scanner/graph';
import { formatForPrompt, MAX_DIRS, MAX_EDGES, summarize } from '../../intent/sampler';

function entry(path: string, language: string): FileEntry {
  return { path, language, size: 0, contentHash: 'h', mtime: 0, rawImports: [] };
}

function index(files: FileEntry[]): ProjectIndex {
  return { schemaVersion: 1, generatedAt: '', rootName: 'r', files };
}

function graphFromEdges(edges: [string, string[]][]): DependencyGraph {
  const e = new Map<string, Set<string>>();
  const r = new Map<string, Set<string>>();
  for (const [from, tos] of edges) {
    e.set(from, new Set(tos));
    for (const t of tos) {
      let rev = r.get(t);
      if (!rev) { rev = new Set(); r.set(t, rev); }
      rev.add(from);
    }
  }
  return { edges: e, reverse: r, unresolved: new Map() };
}

test('summarize aggregates files by directory with language sets', () => {
  const idx = index([
    entry('src/domain/Order.java', 'java'),
    entry('src/domain/Customer.java', 'java'),
    entry('src/web/OrderController.java', 'java'),
  ]);
  const graph = graphFromEdges([]);
  const s = summarize(idx, graph);
  const domain = s.dirs.find((d) => d.dir === 'src/domain');
  assert.equal(domain?.fileCount, 2);
  assert.deepEqual(domain?.languages, ['java']);
  assert.equal(s.totalFiles, 3);
});

test('summarize ignores intra-directory edges', () => {
  const idx = index([entry('src/a/X.java', 'java'), entry('src/a/Y.java', 'java')]);
  const graph = graphFromEdges([['src/a/X.java', ['src/a/Y.java']]]);
  const s = summarize(idx, graph);
  assert.equal(s.edges.length, 0);
});

test('summarize collects cross-directory edges with counts', () => {
  const idx = index([
    entry('src/web/A.java', 'java'),
    entry('src/web/B.java', 'java'),
    entry('src/domain/X.java', 'java'),
  ]);
  const graph = graphFromEdges([
    ['src/web/A.java', ['src/domain/X.java']],
    ['src/web/B.java', ['src/domain/X.java']],
  ]);
  const s = summarize(idx, graph);
  assert.equal(s.edges.length, 1);
  assert.equal(s.edges[0].fromDir, 'src/web');
  assert.equal(s.edges[0].toDir, 'src/domain');
  assert.equal(s.edges[0].count, 2);
});

test('summarize caps dirs and edges', () => {
  const files: FileEntry[] = [];
  for (let i = 0; i < MAX_DIRS + 20; i++) files.push(entry(`src/d${i}/x.java`, 'java'));
  const edgeList: [string, string[]][] = [];
  for (let i = 0; i < MAX_EDGES + 20; i++) {
    edgeList.push([`src/from${i}/a.java`, [`src/to${i}/b.java`]]);
    files.push(entry(`src/from${i}/a.java`, 'java'));
    files.push(entry(`src/to${i}/b.java`, 'java'));
  }
  const s = summarize(index(files), graphFromEdges(edgeList));
  assert.ok(s.dirs.length <= MAX_DIRS);
  assert.ok(s.edges.length <= MAX_EDGES);
});

test('formatForPrompt produces a non-empty rendering with directories + edges', () => {
  const idx = index([entry('src/domain/X.java', 'java'), entry('src/web/Y.java', 'java')]);
  const graph = graphFromEdges([['src/web/Y.java', ['src/domain/X.java']]]);
  const out = formatForPrompt(summarize(idx, graph));
  assert.match(out, /## Directories/);
  assert.match(out, /## Cross-directory imports/);
  assert.match(out, /src\/domain/);
  assert.match(out, /src\/web → src\/domain/);
});

test('formatForPrompt reports "none detected" when graph is empty', () => {
  const idx = index([entry('src/a/X.java', 'java')]);
  const out = formatForPrompt(summarize(idx, graphFromEdges([])));
  assert.match(out, /none detected/);
});
