import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { dueForCheck, isNewer, parseRelease } from './updateCheckPure';

const RELEASES_URL = 'https://api.github.com/repos/johncoleman-thoughtworks/codeup-vscx/releases/latest';
const STATE_KEY_LAST_CHECKED = 'codeup.updateCheck.lastChecked';
const STATE_KEY_DISMISSED_TAG = 'codeup.updateCheck.dismissedTag';
const REQUEST_TIMEOUT_MS = 8_000;

export class UpdateChecker {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly currentVersion: string,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Called on activation. Throttled. Failures are silent (logged to the
   *  output channel only) — an offline user should never see a popup. */
  async checkOnActivation(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('codeup');
    if (!cfg.get<boolean>('updateCheck.enabled', true)) return;
    const intervalHours = cfg.get<number>('updateCheck.intervalHours', 24);
    const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
    const last = this.context.globalState.get<number>(STATE_KEY_LAST_CHECKED);
    if (!dueForCheck(last, intervalMs, Date.now())) return;
    await this.context.globalState.update(STATE_KEY_LAST_CHECKED, Date.now());
    await this.run({ silentOnNoUpdate: true });
  }

  /** Called from the command palette. Always runs, always reports outcome. */
  async checkNow(): Promise<void> {
    await this.context.globalState.update(STATE_KEY_LAST_CHECKED, Date.now());
    await this.run({ silentOnNoUpdate: false });
  }

  private async run(opts: { silentOnNoUpdate: boolean }): Promise<void> {
    let release;
    try {
      release = await this.fetchLatestRelease();
    } catch (err) {
      this.output.appendLine(`[update] check failed: ${(err as Error).message}`);
      if (!opts.silentOnNoUpdate) {
        vscode.window.showWarningMessage(`Codeup update check failed: ${(err as Error).message}`);
      }
      return;
    }
    if (!release) {
      if (!opts.silentOnNoUpdate) {
        vscode.window.showInformationMessage('Codeup: no release information available.');
      }
      return;
    }

    if (!isNewer(release.tag, this.currentVersion)) {
      this.output.appendLine(`[update] up to date (installed ${this.currentVersion}, latest ${release.tag})`);
      if (!opts.silentOnNoUpdate) {
        vscode.window.showInformationMessage(`Codeup ${this.currentVersion} is already the latest.`);
      }
      return;
    }

    // Respect a per-version dismissal so a user who clicked "Later" doesn't
    // get pestered every 24h about the same release.
    const dismissed = this.context.globalState.get<string>(STATE_KEY_DISMISSED_TAG);
    if (opts.silentOnNoUpdate && dismissed === release.tag) {
      this.output.appendLine(`[update] ${release.tag} available but previously dismissed`);
      return;
    }

    const actions: string[] = release.vsixUrl ? ['Install now', 'View release', 'Later'] : ['View release', 'Later'];
    const pick = await vscode.window.showInformationMessage(
      `Codeup ${release.tag} is available (you have ${this.currentVersion}).`,
      ...actions,
    );
    if (pick === 'Install now' && release.vsixUrl) {
      await this.downloadAndInstall(release.tag, release.vsixUrl);
    } else if (pick === 'View release') {
      await vscode.env.openExternal(vscode.Uri.parse(release.htmlUrl));
    } else {
      // "Later" or dismissed via X — remember the tag so we don't re-prompt
      // until a newer release ships.
      await this.context.globalState.update(STATE_KEY_DISMISSED_TAG, release.tag);
    }
  }

  private async fetchLatestRelease() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'codeup-vscode-extension',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 404) {
          this.output.appendLine('[update] no releases published yet');
          return undefined;
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const raw = await res.json();
      return parseRelease(raw);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async downloadAndInstall(tag: string, vsixUrl: string): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Codeup: downloading ${tag}`,
        cancellable: false,
      },
      async () => {
        const tmpPath = path.join(os.tmpdir(), `codeup-${tag.replace(/^v/, '')}.vsix`);
        try {
          await downloadFile(vsixUrl, tmpPath);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Codeup: failed to download ${tag} (${(err as Error).message}). Opening release page instead.`,
          );
          await vscode.env.openExternal(vscode.Uri.parse(vsixUrl));
          return;
        }
        try {
          await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tmpPath));
          const reload = await vscode.window.showInformationMessage(
            `Codeup ${tag} installed. Reload to activate?`,
            'Reload',
            'Later',
          );
          if (reload === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } catch (err) {
          this.output.appendLine(`[update] install command failed: ${(err as Error).message}`);
          vscode.window.showWarningMessage(
            `Codeup: VS Code declined to install the .vsix automatically. Downloaded to ${tmpPath} — install with: code --install-extension "${tmpPath}"`,
          );
        }
      },
    );
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'codeup-vscode-extension' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destination, buf);
}
