import * as crypto from 'crypto';
import ignore, { Ignore } from 'ignore';
import * as vscode from 'vscode';

export interface FileEntry {
  path: string;            // workspace-relative, POSIX separators
  language: string;
  size: number;
  contentHash: string;     // sha256 of bytes
  mtime: number;
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
  // Codeup itself
  '.codeup/index',
  '.codeup/cache',
];

const MAX_FILE_BYTES = 512 * 1024; // skip files larger than 512 KB for now

export async function scanWorkspace(root: vscode.Uri, token?: vscode.CancellationToken): Promise<ProjectIndex> {
  const ig = await loadGitignore(root);
  for (const e of DEFAULT_EXCLUDES) ig.add(e);

  const files: FileEntry[] = [];
  await walk(root, '', ig, files, token);

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootName: root.path.split('/').pop() ?? 'workspace',
    files,
  };
}

async function loadGitignore(root: vscode.Uri): Promise<Ignore> {
  const ig = ignore();
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.gitignore'));
    ig.add(Buffer.from(bytes).toString('utf8'));
  } catch {
    // no .gitignore — fine
  }
  return ig;
}

async function walk(
  root: vscode.Uri,
  rel: string,
  ig: Ignore,
  out: FileEntry[],
  token?: vscode.CancellationToken,
): Promise<void> {
  if (token?.isCancellationRequested) return;
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
    if (ig.ignores(checkPath)) continue;

    if (kind === vscode.FileType.Directory) {
      await walk(root, childRel, ig, out, token);
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
  return {
    path: rel,
    language,
    size: stat.size,
    contentHash: crypto.createHash('sha256').update(bytes).digest('hex'),
    mtime: stat.mtime,
  };
}

export function hashContent(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
