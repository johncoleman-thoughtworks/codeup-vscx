import * as path from 'path';
import { FileEntry, ProjectIndex } from './index';

export interface DependencyGraph {
  // adjacency: from → set of to (workspace-relative paths)
  edges: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
  // unresolved raw imports per file (for diagnostics / type-leakage hints)
  unresolved: Map<string, string[]>;
}

export interface Cycle {
  files: string[]; // ordered around the cycle, first repeats implicitly
}

export function buildGraph(index: ProjectIndex): DependencyGraph {
  const byPath = new Map<string, FileEntry>();
  for (const f of index.files) byPath.set(f.path, f);

  const edges = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const unresolved = new Map<string, string[]>();

  for (const f of index.files) {
    const resolved = new Set<string>();
    const stillUnresolved: string[] = [];
    for (const raw of f.rawImports ?? []) {
      const target = resolveImport(f, raw, byPath);
      if (target && target !== f.path) resolved.add(target);
      else if (!target) stillUnresolved.push(raw);
    }
    if (resolved.size > 0) edges.set(f.path, resolved);
    if (stillUnresolved.length > 0) unresolved.set(f.path, stillUnresolved);
    for (const t of resolved) {
      let r = reverse.get(t);
      if (!r) { r = new Set(); reverse.set(t, r); }
      r.add(f.path);
    }
  }

  return { edges, reverse, unresolved };
}

function resolveImport(from: FileEntry, raw: string, byPath: Map<string, FileEntry>): string | undefined {
  switch (from.language) {
    case 'java':
    case 'kotlin':
    case 'scala':
      return resolveJvm(raw, byPath, from.language);
    case 'typescript':
    case 'typescriptreact':
    case 'javascript':
    case 'javascriptreact':
      return resolveJs(from.path, raw, byPath);
    case 'python':
      return resolvePython(raw, byPath);
    case 'go':
      return resolveGo(raw, byPath);
    case 'csharp':
      return undefined; // namespace-based; can't resolve to a file deterministically
    default:
      return undefined;
  }
}

// "com.example.Foo" → "<root>/com/example/Foo.{java,kt,scala}"
// "com.example.*"   → unresolved (package import, no single file)
function resolveJvm(raw: string, byPath: Map<string, FileEntry>, lang: string): string | undefined {
  if (raw.endsWith('.*')) return undefined;
  const dotted = raw.replace(/\./g, '/');
  const exts =
    lang === 'kotlin' ? ['.kt'] :
    lang === 'scala' ? ['.scala'] :
    ['.java'];
  for (const candidate of byPath.keys()) {
    for (const ext of exts) {
      if (candidate.endsWith('/' + dotted + ext) || candidate === dotted + ext) return candidate;
    }
  }
  return undefined;
}

// Relative imports only — bare-module + path-aliased imports require tsconfig parsing.
function resolveJs(fromPath: string, raw: string, byPath: Map<string, FileEntry>): string | undefined {
  if (!raw.startsWith('.')) return undefined;
  const baseDir = path.posix.dirname(fromPath);
  const joined = path.posix.normalize(path.posix.join(baseDir, raw));
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  for (const e of exts) {
    if (byPath.has(joined + e)) return joined + e;
  }
  for (const e of exts) {
    if (byPath.has(joined + '/index' + e)) return joined + '/index' + e;
  }
  if (byPath.has(joined)) return joined;
  return undefined;
}

// "a.b.c" → "a/b/c.py" OR "a/b/c/__init__.py" anywhere in the tree
function resolvePython(raw: string, byPath: Map<string, FileEntry>): string | undefined {
  if (raw.startsWith('.')) return undefined; // relative — needs current-package context; skip for now
  const dotted = raw.replace(/\./g, '/');
  for (const candidate of byPath.keys()) {
    if (candidate.endsWith('/' + dotted + '.py') || candidate === dotted + '.py') return candidate;
    if (candidate.endsWith('/' + dotted + '/__init__.py') || candidate === dotted + '/__init__.py') return candidate;
  }
  return undefined;
}

// "github.com/me/proj/pkg/sub" → any .go file whose directory ends with "pkg/sub"
function resolveGo(raw: string, byPath: Map<string, FileEntry>): string | undefined {
  const tail = raw.split('/').slice(-2).join('/');
  for (const candidate of byPath.keys()) {
    if (!candidate.endsWith('.go')) continue;
    const dir = path.posix.dirname(candidate);
    if (dir.endsWith('/' + tail) || dir === tail) return candidate;
  }
  return undefined;
}

// Tarjan's strongly-connected components — every SCC of size > 1 is a cycle.
// Self-loops also reported (SCC of size 1 with a self-edge).
export function findCycles(graph: DependencyGraph): Cycle[] {
  const cycles: Cycle[] = [];
  let idx = 0;
  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const nodes = new Set<string>([...graph.edges.keys(), ...graph.reverse.keys()]);

  const strongconnect = (v: string): void => {
    indexOf.set(v, idx);
    lowlink.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);

    const succ = graph.edges.get(v) ?? new Set<string>();
    for (const w of succ) {
      if (!indexOf.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indexOf.get(w)!));
      }
    }

    if (lowlink.get(v) === indexOf.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) {
        cycles.push({ files: component.reverse() });
      } else if (succ.has(v)) {
        cycles.push({ files: [v] });
      }
    }
  };

  for (const v of nodes) if (!indexOf.has(v)) strongconnect(v);
  return cycles;
}

export function neighborsOf(graph: DependencyGraph, file: string): { imports: string[]; importedBy: string[] } {
  return {
    imports: [...(graph.edges.get(file) ?? [])],
    importedBy: [...(graph.reverse.get(file) ?? [])],
  };
}
