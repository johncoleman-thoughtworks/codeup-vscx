import * as vscode from 'vscode';
import { ReportedFinding } from './tools';

const CACHE_REL = '.codeup/cache/analysis.json';

interface CacheFile {
  schemaVersion: 1;
  entries: Record<string, CacheEntry>;
}

interface CacheEntry {
  analyzedAt: string;
  findings: ReportedFinding[];
}

export class AnalysisCache {
  private data: CacheFile = { schemaVersion: 1, entries: {} };
  private loaded = false;

  constructor(private readonly root: vscode.Uri) {}

  static key(contentHash: string, catalogueHash: string, model: string, neighborsKey = ''): string {
    return `${contentHash}:${catalogueHash}:${model}:${neighborsKey}`;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, CACHE_REL));
      this.data = JSON.parse(Buffer.from(bytes).toString('utf8')) as CacheFile;
    } catch {
      // missing — fine
    }
    this.loaded = true;
  }

  get(key: string): CacheEntry | undefined {
    return this.data.entries[key];
  }

  async put(key: string, findings: ReportedFinding[]): Promise<void> {
    this.data.entries[key] = { analyzedAt: new Date().toISOString(), findings };
    await this.flush();
  }

  private async flush(): Promise<void> {
    const dir = vscode.Uri.joinPath(this.root, '.codeup/cache');
    await vscode.workspace.fs.createDirectory(dir);
    const uri = vscode.Uri.joinPath(this.root, CACHE_REL);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(this.data, null, 2), 'utf8'));
  }
}
