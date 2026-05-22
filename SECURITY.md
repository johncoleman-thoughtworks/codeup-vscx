# Security

## Supply-chain checks in the build pipeline

Every `.vsix` build runs two automated gates before packaging:

| Gate | Command | What it catches |
|---|---|---|
| Known-CVE audit | `npm audit --omit=dev --audit-level=high` | Production dependencies with high or critical severity vulnerabilities in the npm advisory database. |
| Lockfile integrity | `npm ci --omit=dev --dry-run --ignore-scripts` | Hand-edits to `package-lock.json` that don't agree with `package.json` — would catch an attacker swapping a dep version without going through `npm install`. |

Both are wired into `vscode:prepublish`, so `vsce package` and any release CI automatically gate on them. They cannot be skipped without removing the script.

To run them manually:

```bash
npm run security:check   # both gates
npm run security:audit   # CVE check only
npm run security:lockfile # lockfile integrity only
```

## What these gates do NOT catch

- **Fresh supply-chain compromise.** If a maintainer's npm account was taken over yesterday and a malicious version pushed to npm, the npm advisory DB does not know about it yet. The lag is typically days to weeks.
- **Low-severity issues.** The audit threshold is `high`. Medium and low vulnerabilities still print warnings but don't block — they're tracked and fixed at the next dependency bump.
- **Malicious packages with no published CVE.** Behavioural risk (postinstall scripts running shell commands, packages exfiltrating environment variables) is not in the npm advisory DB.

## Optional third layer for higher assurance

For repos that need behavioural / fresh-compromise checks, integrate [Socket](https://socket.dev) as a GitHub App. It posts a PR comment on every dependency change flagging suspicious patterns (recent maintainer changes, new postinstall scripts, network-using code, etc.). Free for public repositories. Not wired in by default in this repo.

## Reporting a vulnerability

If you find a security issue in Codeup itself, please open a private security advisory via the **Security** tab of the GitHub repository rather than a public issue.
