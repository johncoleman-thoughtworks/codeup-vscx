# Codeup

VS Code extension that surfaces anti-patterns in your codebase, powered by the Anthropic API.

Findings are persisted as files under `.codeup/` so they travel with the repo and go through PR review.

## What it detects

90 catalogued patterns spanning:

- **Single-file smells** — god class, anemic domain model, long methods, primitive obsession, deep nesting, error swallowing, etc.
- **Cross-file structure** — type leakage across boundaries, shotgun surgery, feature envy with neighbor context.
- **Module dependency** — deterministic cyclic-dependency detection (Tarjan SCC), layer-boundary violations driven by an optional `.codeup/intent.yaml`.
- **Service-level** — distributed monolith indicators, shared-database, reach-through reads, god service.
- **Data / persistence** — N+1 queries, lost updates, cache-as-source-of-truth, EAV overuse, god tables.
- **Process / judgement** — premature optimisation/abstraction, copy-paste programming, golden hammer, lava flow.

See [`resources/catalogue/default.yaml`](resources/catalogue/default.yaml) for the full list.

## Setup

1. **Install** — `npm install && npm run compile` (or grab the packaged `.vsix` from a release).
2. **Set your Anthropic API key** — Command Palette → `Codeup: Set Anthropic API Key`. Stored in VS Code's `SecretStorage` (macOS Keychain / Windows DPAPI / Linux libsecret) — never in `settings.json` or in your repo.
3. **Open a workspace** and click the `{^}` icon in the activity bar.

## Daily flow

1. **Run a scan** — `Codeup: Run Full Scan` (workspace) or `Codeup: Scan Current File`. The first run prompts to confirm the estimated cost.
2. **Triage findings** in the tree:
   - Click a finding to open the file at the right line and the details webview side-by-side.
   - **Confirm** if it's a real issue — the finding becomes a positive exemplar in `.codeup/knowledge/exemplars.yaml`.
   - **Dismiss…** if it's a false positive — Codeup prompts for a rationale, which is saved to `.codeup/knowledge/dismissals.yaml`. Future scans see this and learn from it.
   - **Mark Fixed** once you've made the change.
3. **Rescan** — unchanged files come from cache (no API cost). Changed files re-analyze.

## What's stored in `.codeup/`

Codeup writes everything under `.codeup/` in your workspace root (per-root in multi-root setups).

| Path | Purpose | Commit? |
|---|---|---|
| `.codeup/findings/*.yaml` | One file per finding — category, severity, status, location, history. Reviewed in PRs. | **Yes** |
| `.codeup/knowledge/dismissals.yaml` | Dismissal rationales injected into future analysis prompts. | **Yes** |
| `.codeup/knowledge/exemplars.yaml` | Confirmed findings used as positive examples. | **Yes** |
| `.codeup/knowledge/patterns.yaml` | Team-specific catalogue extensions / overrides. | **Yes** |
| `.codeup/intent.yaml` | Layer rules used for deterministic layer-violation findings. | **Yes** |
| `.codeup/index/` | Generated workspace index + dependency graph. | **No** |
| `.codeup/cache/` | Per-content-hash analysis cache. Local-only optimisation. | **No** |

### `.gitignore`

Codeup drops a `.gitignore` inside each generated directory (`.codeup/index/` and `.codeup/cache/`) automatically, so the contents are ignored even if you do nothing. For belt-and-braces, add these to your project's root `.gitignore`:

```
.codeup/index/
.codeup/cache/
```

Keep `.codeup/findings/`, `.codeup/knowledge/`, and `.codeup/intent.yaml` **tracked** — they're the parts that travel with the repo and accumulate decisions.

## Settings

| Setting | Default | Description |
|---|---|---|
| `codeup.model` | `claude-sonnet-4-6` | Anthropic model used for analysis. |
| `codeup.scan.onSave` | `false` | Run incremental scans on file save. |
| `codeup.findingsDir` | `.codeup/findings` | Where findings YAML files live (workspace-relative). |

## Optional: `.codeup/intent.yaml`

Drop a file at `.codeup/intent.yaml` to declare layer rules. Each layer's `match` is a minimatch glob against the workspace-relative path; `cannotDependOn` lists layer names this layer must never import from. Violations are reported as `layer-violation` findings without any API cost.

Trailing-slash patterns (e.g. `src/foo/`) auto-extend to `src/foo/**`, so simple prefix rules still work. For monorepos, use a wildcard segment so one rule covers every package:

```yaml
layers:
  - layer: domain
    match: 'packages/*/src/**/domain/**'
    cannotDependOn: [infrastructure, web]
```

To get a starting draft, run `Codeup: Suggest Architectural Intent`. Codeup compresses the directory layout + dependency graph into a small summary, asks Claude to propose layer rules, and writes the result to `.codeup/intent.yaml` (or opens it as an untitled buffer if the file already exists). Review and edit before your next scan — the proposal is a starting point, not the final word.


```yaml
layers:
  - layer: domain
    match: src/main/java/com/example/domain/
    cannotDependOn: [infrastructure, web]
  - layer: application
    match: src/main/java/com/example/application/
    cannotDependOn: [web]
  - layer: web
    match: src/main/java/com/example/web/
    cannotDependOn: []
  - layer: infrastructure
    match: src/main/java/com/example/infrastructure/
    cannotDependOn: []
```

See [`resources/intent.example.yaml`](resources/intent.example.yaml) for a starting template.

## Multi-root workspaces

Each root keeps its own `.codeup/` on disk (state travels with each project's repo). The tree view shows a per-root group at the top level when there's more than one folder.

## Cost expectations

- Scans use `tool_use` for structured output so Claude only emits findings, not prose — keeps output tokens small.
- The pre-flight prompt shows estimated cost before any full scan runs.
- Cached files skip the API entirely. A second scan of unchanged code is free.
- Catalogue + knowledge are part of the cache key — bumping either invalidates relevant entries.

## Development

```bash
npm install
npm run compile         # tsc
npm test                # 65 unit tests via node:test
npm run test:integration # @vscode/test-electron (first run downloads VS Code)
```

Press `F5` in this folder to launch the Extension Development Host with the extension loaded.

See [PLAN.md](PLAN.md) for the implementation roadmap and [TESTING.md](TESTING.md) for the testing strategy.

## Status

Milestones M0–M4 shipped. M5 (CLI / CI / marketplace packaging) is the remaining work.
