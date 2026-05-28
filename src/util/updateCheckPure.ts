// Pure helpers for the update-check feature. No vscode / no fs / no
// network — unit-testable in plain Node.

/**
 * Compare two semver-shaped version strings (vX.Y.Z or X.Y.Z). Returns
 * -1 if `a < b`, 0 if equal, 1 if `a > b`. Pre-release tags
 * (e.g. "1.0.0-beta.1") are stripped before comparison — pre-releases
 * compare as equal to their associated release for our purposes,
 * which is what we want for an update-check (we never want to
 * downgrade a user from a release to a pre-release).
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalize(a);
  const pb = normalize(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function normalize(version: string): number[] {
  const stripped = version.replace(/^v/, '').split('-')[0].split('+')[0];
  const parts = stripped.split('.').map((s) => Number.parseInt(s, 10));
  if (parts.some((n) => Number.isNaN(n))) return [0, 0, 0];
  return parts;
}

export function isNewer(remoteVersion: string, installedVersion: string): boolean {
  return compareSemver(remoteVersion, installedVersion) > 0;
}

/**
 * Decide whether enough time has passed since the last update check to
 * justify another network call. Throttling prevents the extension from
 * pinging GitHub on every activation when users start the editor many
 * times a day.
 */
export function dueForCheck(lastCheckedMs: number | undefined, intervalMs: number, nowMs: number): boolean {
  if (lastCheckedMs === undefined || lastCheckedMs === 0) return true;
  return nowMs - lastCheckedMs >= intervalMs;
}

export interface GithubReleaseShape {
  tag_name: string;
  name?: string;
  html_url: string;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string }[];
}

export interface ParsedRelease {
  tag: string;
  htmlUrl: string;
  vsixUrl?: string;
  prerelease: boolean;
}

/**
 * Pull the bits the update-checker actually needs out of a GitHub
 * /releases/latest response. Defensive against missing fields.
 */
export function parseRelease(raw: unknown): ParsedRelease | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as GithubReleaseShape;
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return undefined;
  const vsixAsset = r.assets?.find((a) => a.name?.endsWith('.vsix'));
  return {
    tag: r.tag_name,
    htmlUrl: r.html_url,
    vsixUrl: vsixAsset?.browser_download_url,
    prerelease: Boolean(r.prerelease),
  };
}

const ALLOWED_VSIX_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/**
 * Allowlist for VSIX download origins. The auto-updater refuses to install
 * any URL that fails this check — without origin pinning, a compromised
 * release JSON could redirect users to an attacker-controlled host.
 */
export function isAllowedVsixUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_VSIX_HOSTS.has(parsed.hostname);
}
