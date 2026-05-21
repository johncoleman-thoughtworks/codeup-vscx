import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ensureSelfIgnored } from '../util/selfIgnore';
import { analysisCacheKey } from './cacheKey';
import { ReportedFinding } from './tools';

// Layout: .codeup/cache/entries/<sha256(key).slice(0,32)>.json
// One file per cache entry, lazy-loaded. Scales to monorepos that would
// be painful as a single JSON blob.
//
// The historic monolithic .codeup/cache/analysis.json is migrated to the
// new layout the first time the cache is opened on a workspace that has
// one.

const ENTRIES_DIR = '.codeup/cache/entries';
const LEGACY_FILE = '.codeup/cache/analysis.json';

interface CacheEntry {
  key: string;
  analyzedAt: string;
  findings: ReportedFinding[];
}

export class AnalysisCache {
  private memory = new Map<string, CacheEntry>();
  private initialized = false;

  constructor(private readonly root: vscode.Uri) {}

  static key = analysisCacheKey;

  async load(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.migrateLegacyIfPresent();
  }

  get(key: string): CacheEntry | undefined {
    const cached = this.memory.get(key);
    if (cached) return cached;
    return this.readEntrySync(key);
  }

  async put(key: string, findings: ReportedFinding[]): Promise<void> {
    const entry: CacheEntry = { key, analyzedAt: new Date().toISOString(), findings };
    this.memory.set(key, entry);
    await this.writeEntry(key, entry);
  }

  private filenameFor(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json';
  }

  private entryUri(key: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ENTRIES_DIR, this.filenameFor(key));
  }

  // Synchronous read using node fs — VS Code's fs API is async, but get()
  // is called synchronously from the analyzer. We accept the blocking cost
  // because cache reads are tiny and hot.
  private readEntrySync(key: string): CacheEntry | undefined {
    try {
      const fs = require('fs') as typeof import('fs');
      const p = this.entryUri(key).fsPath;
      if (!fs.existsSync(p)) return undefined;
      const raw = fs.readFileSync(p, 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      this.memory.set(key, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  private async writeEntry(key: string, entry: CacheEntry): Promise<void> {
    const cacheRoot = vscode.Uri.joinPath(this.root, '.codeup/cache');
    const dir = vscode.Uri.joinPath(this.root, ENTRIES_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    await ensureSelfIgnored(cacheRoot);
    const uri = this.entryUri(key);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(entry, null, 2), 'utf8'));
  }

  private async migrateLegacyIfPresent(): Promise<void> {
    const legacy = vscode.Uri.joinPath(this.root, LEGACY_FILE);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(legacy);
    } catch {
      return; // no legacy file, nothing to do
    }
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        entries?: Record<string, Omit<CacheEntry, 'key'>>;
      };
      const entries = parsed.entries ?? {};
      let migrated = 0;
      for (const [key, value] of Object.entries(entries)) {
        await this.writeEntry(key, { key, analyzedAt: value.analyzedAt, findings: value.findings });
        migrated++;
      }
      // Delete the legacy file after successful migration.
      await vscode.workspace.fs.delete(legacy);
      // eslint-disable-next-line no-console
      console.log(`[codeup] migrated ${migrated} cache entries from analysis.json to entries/`);
    } catch {
      // Migration is best-effort; if the legacy file is corrupt we leave it.
    }
  }
}
