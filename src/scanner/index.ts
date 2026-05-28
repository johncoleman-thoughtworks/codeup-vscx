import * as crypto from 'crypto';
import ignore, { Ignore } from 'ignore';
import * as vscode from 'vscode';
import { extractImports } from './imports';
import { parseIgnoreText } from './ignoreLoader';

export interface FileEntry {
  path: string;            // workspace-relative, POSIX separators
  language: string;
  size: number;
  contentHash: string;     // sha256 of bytes
  mtime: number;
  rawImports: string[];    // module specifiers as written in source
}

export interface ProjectIndex {
  schemaVersion: 1;
  generatedAt: string;
  rootName: string;
  files: FileEntry[];
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', scala: 'scala',
  cs: 'csharp', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c',
  php: 'php', swift: 'swift',
  md: 'markdown', yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  html: 'html', css: 'css', scss: 'scss',
  sql: 'sql',
};

const DEFAULT_EXCLUDES = [
  // VCS / editor
  '.git',
  '.idea',
  '.vscode-test',
  // Node
  'node_modules',
  'dist',
  'out',
  // JVM / Gradle / Maven / Kotlin
  'build',
  '.gradle',
  '.kotlin',
  'target',
  '.mvn',
  'bin',
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  // Go
  'vendor',
  '*.exe',
  '*.test',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '*.egg-info',
  '*.pyc',
  '*.pyo',
  // .NET
  'obj',
  'packages',
  '.vs',
  'TestResults',
  '*.dll',
  '*.pdb',
  '*.nupkg',
  '*.suo',
  '*.user',
  // Codeup itself — never analyze its own state
  '.codeup',
  // Generated dependency lock files. Always committed, often huge,
  // never meaningfully analyzable as source — flagging them as
  // oversized just spams the report. Mirrors codeup-cli's default set.
  'Cargo.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'mix.lock',
  'Podfile.lock',
  'packages.lock.json',
];

const MAX_FILE_BYTES = 512 * 1024; // skip files larger than 512 KB for now

interface IgnoreStack {
  /** Non-user-overridable always-skips (.git, node_modules, .codeup, …). */
  defaults: Ignore;
  /** Patterns from every .gitignore discovered during the walk. */
  gitIg: Ignore;
  /** Patterns from every .codeupignore discovered during the walk. */
  codeupIg: Ignore;
}

export async function scanWorkspace(root: vscode.Uri, token?: vscode.CancellationToken): Promise<ProjectIndex> {
  const stack: IgnoreStack = {
    defaults: ignore().add(DEFAULT_EXCLUDES),
    gitIg: ignore(),
    codeupIg: ignore(),
  };

  const files: FileEntry[] = [];
  await walk(root, '', stack, files, token);

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootName: root.path.split('/').pop() ?? 'workspace',
    files,
  };
}

async function loadScopedIgnore(root: vscode.Uri, scopeDir: string, name: string, target: Ignore): Promise<void> {
  const fileUri = scopeDir
    ? vscode.Uri.joinPath(root, scopeDir, name)
    : vscode.Uri.joinPath(root, name);
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(fileUri);
  } catch {
    return; // file does not exist — fine
  }
  const text = Buffer.from(bytes).toString('utf8');
  for (const pattern of parseIgnoreText(text, scopeDir)) target.add(pattern);
}

/**
 * Decide whether a path should be walked. .codeupignore wins over
 * .gitignore at any depth via the library's .test() method; defaults
 * are non-overridable.
 */
function shouldSkip(stack: IgnoreStack, checkPath: string): boolean {
  if (stack.defaults.ignores(checkPath)) return true;
  const ci = stack.codeupIg.test(checkPath);
  if (ci.ignored) return true;
  if (ci.unignored) return false;
  return stack.gitIg.ignores(checkPath);
}

async function walk(
  root: vscode.Uri,
  rel: string,
  stack: IgnoreStack,
  out: FileEntry[],
  token?: vscode.CancellationToken,
): Promise<void> {
  if (token?.isCancellationRequested) return;
  // Load this directory's ignore files before consulting any rule for
  // its entries — so a parent's .gitignore cannot hide the .codeupignore
  // that sits beside it.
  await loadScopedIgnore(root, rel, '.gitignore', stack.gitIg);
  await loadScopedIgnore(root, rel, '.codeupignore', stack.codeupIg);

  const dirUri = rel ? vscode.Uri.joinPath(root, rel) : root;
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return;
  }
  for (const [name, kind] of entries) {
    if (token?.isCancellationRequested) return;
    const childRel = rel ? `${rel}/${name}` : name;
    const checkPath = kind === vscode.FileType.Directory ? `${childRel}/` : childRel;
    if (shouldSkip(stack, checkPath)) continue;

    if (kind === vscode.FileType.Directory) {
      await walk(root, childRel, stack, out, token);
    } else if (kind === vscode.FileType.File) {
      const entry = await fileEntry(root, childRel);
      if (entry) out.push(entry);
    }
  }
}

async function fileEntry(root: vscode.Uri, rel: string): Promise<FileEntry | undefined> {
  const uri = vscode.Uri.joinPath(root, rel);
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
  if (stat.size > MAX_FILE_BYTES) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
  const ext = rel.split('.').pop()?.toLowerCase() ?? '';
  const language = LANGUAGE_BY_EXT[ext] ?? 'plaintext';
  let rawImports: string[] = [];
  try {
    const text = Buffer.from(bytes).toString('utf8');
    rawImports = extractImports(language, text).raw;
  } catch {
    // best-effort
  }
  return {
    path: rel,
    language,
    size: stat.size,
    contentHash: crypto.createHash('sha256').update(bytes).digest('hex'),
    mtime: stat.mtime,
    rawImports,
  };
}

export function hashContent(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
