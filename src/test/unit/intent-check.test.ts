import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cycleFindings, layerViolations } from '../../intent/check';
import { IntentConfig } from '../../intent/layers';
import type { DependencyGraph } from '../../scanner/graph';

test('cycleFindings produces one finding per cycle, all high severity', () => {
  const findings = cycleFindings([
    { files: ['src/a.ts', 'src/b.ts'] },
    { files: ['src/x.ts', 'src/y.ts', 'src/z.ts'] },
  ]);
  assert.equal(findings.length, 2);
  for (const f of findings) {
    assert.equal(f.category, 'cyclic-dependency');
    assert.equal(f.severity, 'high');
    assert.equal(f.status, 'unconfirmed');
    assert.equal(f.detectedBy, 'codeup-deterministic');
  }
});

test('cycleFindings produces stable ids across runs', () => {
  const cycle = { files: ['src/a.ts', 'src/b.ts'] };
  const a = cycleFindings([cycle])[0].id;
  const b = cycleFindings([cycle])[0].id;
  assert.equal(a, b);
});

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

test('layerViolations flags a forbidden cross-layer import', () => {
  const intent: IntentConfig = {
    layers: [
      { layer: 'domain', match: 'src/domain/', cannotDependOn: ['infrastructure'] },
      { layer: 'infrastructure', match: 'src/infrastructure/', cannotDependOn: [] },
    ],
  };
  const graph = graphFromEdges([['src/domain/Order.java', ['src/infrastructure/Db.java']]]);
  const findings = layerViolations(graph, intent);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'layer-violation');
  assert.equal(findings[0].location.file, 'src/domain/Order.java');
});

test('layerViolations is quiet when no rule is violated', () => {
  const intent: IntentConfig = {
    layers: [
      { layer: 'domain', match: 'src/domain/', cannotDependOn: ['infrastructure'] },
      { layer: 'infrastructure', match: 'src/infrastructure/', cannotDependOn: [] },
    ],
  };
  const graph = graphFromEdges([['src/infrastructure/Db.java', ['src/domain/Order.java']]]); // reverse is fine
  assert.deepEqual(layerViolations(graph, intent), []);
});
