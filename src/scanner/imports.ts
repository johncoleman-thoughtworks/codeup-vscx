// Per-language import extraction. Regex-based on purpose — tree-sitter is a
// later upgrade. Returns raw module specifiers as they appear in source; the
// graph builder is responsible for resolving them to workspace files.

export interface ExtractedImports {
  raw: string[];
}

export function extractImports(language: string, text: string): ExtractedImports {
  switch (language) {
    case 'java':
    case 'kotlin':
    case 'scala':
      return jvmImports(text);
    case 'typescript':
    case 'typescriptreact':
    case 'javascript':
    case 'javascriptreact':
      return jsImports(text);
    case 'python':
      return pythonImports(text);
    case 'go':
      return goImports(text);
    case 'csharp':
      return csharpImports(text);
    default:
      return { raw: [] };
  }
}

// import com.example.Foo;       → "com.example.Foo"
// import com.example.*;         → "com.example.*"
// import static com.x.Y.method; → "com.x.Y" (drop tail member)
const JVM_RE = /^\s*import\s+(static\s+)?([a-zA-Z_][\w.]*\*?)\s*;?\s*$/gm;
function jvmImports(text: string): ExtractedImports {
  const raw: string[] = [];
  for (const m of text.matchAll(JVM_RE)) {
    const isStatic = !!m[1];
    let imp = m[2];
    if (isStatic && !imp.endsWith('.*')) {
      const lastDot = imp.lastIndexOf('.');
      if (lastDot > 0) imp = imp.slice(0, lastDot);
    }
    raw.push(imp);
  }
  return { raw };
}

// import ... from 'x'   |   import 'x'   |   require('x')   |   import('x')
const JS_RE = /(?:from|require\(|import\()\s*['"]([^'"]+)['"]\)?/g;
const JS_BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
function jsImports(text: string): ExtractedImports {
  const raw: string[] = [];
  for (const m of text.matchAll(JS_RE)) raw.push(m[1]);
  for (const m of text.matchAll(JS_BARE_IMPORT_RE)) raw.push(m[1]);
  return { raw };
}

// from a.b.c import x  →  "a.b.c"
// import a.b           →  "a.b"
// import a, b          →  "a", "b"
function pythonImports(text: string): ExtractedImports {
  const raw: string[] = [];
  const lineRe = /^\s*(?:from\s+([\w.]+)\s+import\s+.+|import\s+([\w. ,]+))$/gm;
  for (const m of text.matchAll(lineRe)) {
    if (m[1]) raw.push(m[1]);
    else if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) raw.push(name);
      }
    }
  }
  return { raw };
}

// import "github.com/x/y"     (single)
// import (   "a"   "b"   )    (block)
function goImports(text: string): ExtractedImports {
  const raw: string[] = [];
  const single = /^\s*import\s+(?:\w+\s+)?"([^"]+)"\s*$/gm;
  for (const m of text.matchAll(single)) raw.push(m[1]);
  const blocks = /^\s*import\s*\(([\s\S]*?)\)/gm;
  for (const m of text.matchAll(blocks)) {
    const inner = m[1];
    const inside = /(?:\w+\s+)?"([^"]+)"/g;
    for (const im of inner.matchAll(inside)) raw.push(im[1]);
  }
  return { raw };
}

// using Foo.Bar;  →  "Foo.Bar"
// using static Foo.Bar.Baz;  →  "Foo.Bar.Baz"
const CS_RE = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;\s*$/gm;
function csharpImports(text: string): ExtractedImports {
  const raw: string[] = [];
  for (const m of text.matchAll(CS_RE)) raw.push(m[1]);
  return { raw };
}
