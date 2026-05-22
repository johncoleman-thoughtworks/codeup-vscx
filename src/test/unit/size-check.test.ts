import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { FileEntry, ProjectIndex } from '../../scanner';
import { DEFAULT_SIZE_OPTIONS, oversizedFiles } from '../../quality/sizeCheck';

function entry(path: string, size: number, language: string = 'typescript'): FileEntry {
  return { path, language, size, contentHash: 'h_' + path, mtime: 0, rawImports: [] };
}

function index(files: FileEntry[]): ProjectIndex {
  return { schemaVersion: 1, generatedAt: '', rootName: 'r', files };
}

test('oversizedFiles: no findings below warn threshold', () => {
  const idx = index([entry('small.ts', 1000), entry('medium.ts', 29_999)]);
  assert.deepEqual(oversizedFiles(idx), []);
});

test('oversizedFiles: medium severity between warn and critical', () => {
  const idx = index([entry('big.ts', 45_000)]);
  const findings = oversizedFiles(idx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'medium');
  assert.equal(findings[0].category, 'oversized-file');
  assert.match(findings[0].explanation, /45,000 bytes/);
});

test('oversizedFiles: high severity at or above critical', () => {
  const idx = index([entry('huge.ts', 80_000)]);
  const findings = oversizedFiles(idx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'high');
  assert.match(findings[0].explanation, /beyond Codeup's 60,000-byte analysis cap/);
});

test('oversizedFiles: exact threshold boundaries', () => {
  const idx = index([
    entry('at-warn.ts', 30_000),
    entry('at-critical.ts', 60_000),
  ]);
  const findings = oversizedFiles(idx);
  assert.equal(findings.length, 2);
  const byPath = new Map(findings.map((f) => [f.location.file, f]));
  assert.equal(byPath.get('at-warn.ts')?.severity, 'medium');
  assert.equal(byPath.get('at-critical.ts')?.severity, 'high');
});

test('oversizedFiles: stable ids across runs', () => {
  const idx = index([entry('foo.ts', 50_000)]);
  const a = oversizedFiles(idx)[0].id;
  const b = oversizedFiles(idx)[0].id;
  assert.equal(a, b);
});

test('oversizedFiles: respects custom thresholds', () => {
  const idx = index([entry('foo.ts', 5_000)]);
  const findings = oversizedFiles(idx, { warnBytes: 1_000, criticalBytes: 10_000 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'medium');
});

test('oversizedFiles: detector is codeup-deterministic', () => {
  const idx = index([entry('big.ts', 50_000)]);
  assert.equal(oversizedFiles(idx)[0].detectedBy, 'codeup-deterministic');
});

test('oversizedFiles: default options match DEFAULT_SIZE_OPTIONS', () => {
  assert.equal(DEFAULT_SIZE_OPTIONS.warnBytes, 30_000);
  assert.equal(DEFAULT_SIZE_OPTIONS.criticalBytes, 60_000);
});

test('oversizedFiles: skips non-source languages (data files, docs)', () => {
  // Large catalogue YAMLs / JSON schemas / markdown docs routinely cross
  // the warn threshold for legitimate reasons. They should not produce
  // findings — oversized-file is only meaningful for actual source.
  const idx = index([
    entry('catalogue.yaml', 80_000, 'yaml'),
    entry('schema.json', 80_000, 'json'),
    entry('Cargo.toml.snapshot', 80_000, 'toml'),
    entry('README.md', 80_000, 'markdown'),
    entry('big.ts', 80_000, 'typescript'),
  ]);
  const findings = oversizedFiles(idx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].location.file, 'big.ts');
});
