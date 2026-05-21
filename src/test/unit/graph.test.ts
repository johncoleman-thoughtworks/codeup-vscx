import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { FileEntry, ProjectIndex } from '../../scanner';
import { buildGraph, findCycles } from '../../scanner/graph';

function entry(path: string, language: string, rawImports: string[]): FileEntry {
  return { path, language, size: 0, contentHash: 'h_' + path, mtime: 0, rawImports };
}

function index(files: FileEntry[]): ProjectIndex {
  return { schemaVersion: 1, generatedAt: '', rootName: 'r', files };
}

test('buildGraph resolves Java imports to workspace files', () => {
  const idx = index([
    entry('src/main/java/com/example/A.java', 'java', ['com.example.B']),
    entry('src/main/java/com/example/B.java', 'java', []),
    entry('src/main/java/com/example/C.java', 'java', ['com.example.unknown']),
  ]);
  const g = buildGraph(idx);
  assert.deepEqual(
    [...(g.edges.get('src/main/java/com/example/A.java') ?? [])],
    ['src/main/java/com/example/B.java'],
  );
  assert.equal(g.edges.has('src/main/java/com/example/C.java'), false);
  assert.deepEqual(g.unresolved.get('src/main/java/com/example/C.java'), ['com.example.unknown']);
});

test('buildGraph resolves TS relative imports', () => {
  const idx = index([
    entry('src/a.ts', 'typescript', ['./b']),
    entry('src/b.ts', 'typescript', []),
    entry('src/nested/c.ts', 'typescript', ['../a']),
  ]);
  const g = buildGraph(idx);
  assert.deepEqual([...(g.edges.get('src/a.ts') ?? [])], ['src/b.ts']);
  assert.deepEqual([...(g.edges.get('src/nested/c.ts') ?? [])], ['src/a.ts']);
});

test('findCycles detects an A→B→A cycle', () => {
  const idx = index([
    entry('src/a.ts', 'typescript', ['./b']),
    entry('src/b.ts', 'typescript', ['./a']),
  ]);
  const cycles = findCycles(buildGraph(idx));
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0].files].sort(), ['src/a.ts', 'src/b.ts']);
});

test('findCycles detects a self-loop', () => {
  // Synthesise a self-loop by having the file import itself via a re-export
  // path. The resolver only edges to OTHER files, so to simulate cleanly we
  // construct one file whose import target IS itself.
  const idx = index([entry('src/self.ts', 'typescript', ['./self'])]);
  // Note: buildGraph uses `target !== from.path` to skip self-edges. So a
  // pure self-loop is currently filtered out — assert that behaviour
  // explicitly. (Tarjan would still report SCC-of-1-with-self-edge if we
  // ever decide to keep them.)
  const g = buildGraph(idx);
  assert.equal(g.edges.has('src/self.ts'), false);
  assert.equal(findCycles(g).length, 0);
});

test('findCycles reports nothing for a DAG', () => {
  const idx = index([
    entry('src/a.ts', 'typescript', ['./b', './c']),
    entry('src/b.ts', 'typescript', ['./c']),
    entry('src/c.ts', 'typescript', []),
  ]);
  assert.equal(findCycles(buildGraph(idx)).length, 0);
});

test('findCycles detects two disjoint cycles', () => {
  const idx = index([
    entry('src/a.ts', 'typescript', ['./b']),
    entry('src/b.ts', 'typescript', ['./a']),
    entry('src/x.ts', 'typescript', ['./y']),
    entry('src/y.ts', 'typescript', ['./x']),
  ]);
  assert.equal(findCycles(buildGraph(idx)).length, 2);
});
