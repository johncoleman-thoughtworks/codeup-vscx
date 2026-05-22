# Codeup

VS Code extension that surfaces anti-patterns in your codebase, powered by the Anthropic API.

Findings are persisted as files under `.codeup/` so they travel with the repo and go through PR review.

## What it detects

95 catalogued patterns spanning:

- **Single-file smells** — god class, anemic domain model, long methods, primitive obsession, deep nesting, high cognitive complexity, error swallowing, function-name mismatches, etc.
- **Inheritance & OO shape** — non-exclusive subtypes (roles modelled as inheritance), procedural shell classes (Manager / Handler / Processor), base classes that depend on their subclasses, parallel inheritance hierarchies.
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

## Data handling — please read before scanning client code

Codeup sends source code to the Anthropic API when it runs the LLM-driven catalogue. **For the avoidance of doubt:** if you point Codeup at a client repository, source from that repository will leave your machine. You are responsible for confirming that this is acceptable under any NDA or data-handling agreement that applies.

**What gets sent over HTTPS to `api.anthropic.com`:**

- The full text of any file Codeup analyzes (verbatim, between code fences).
- Up to 6 *neighbor* files per analyzed file (importers, imported modules, and same-package siblings), each truncated to 8,000 characters.
- The text of any team-authored dismissal rationales and exemplar explanations retrieved from `.codeup/knowledge/` as context for the current analysis.
- Pattern hints from the catalogue and the analyzer's system prompt.

**What never gets sent:**

- Files excluded by your `.gitignore` or the scanner's default excludes (`node_modules`, `.git`, `dist`, `build`, `target`, `.codeup/` itself, etc.).
- Files over 512 KB on disk or over 60,000 characters at analysis time.
- Files in a language that has no matching catalogue patterns.
- Files whose contents are unchanged since the last scan (cache hit — zero API calls).
- The deterministic findings (`cyclic-dependency`, `layer-violation`) — graph-only, no API call ever.
- Your `.codeup/findings/` records, your `.codeup/cache/`, or your API key (used in the auth header, never as content).

**Anthropic's terms** (commercial API use): inputs and outputs are not used to train models. Retention is for abuse detection and bounded by Anthropic's data retention policy. Customers with stricter requirements can request Zero Data Retention agreements; deployment via AWS Bedrock or GCP Vertex is also an option for keeping requests inside a customer-controlled cloud (would require a small adapter — not yet built into Codeup).

**If you cannot send client source off the machine**, you can still get value from Codeup's deterministic checks (cycles, layer violations) without any API call. A `codeup.scan.deterministicOnly` setting that disables the LLM pass entirely is a planned addition — open an issue if you need it before then.

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

## Commands

All commands are available from the Command Palette (`⇧⌘P` / `Ctrl+Shift+P`):

| Command | Purpose |
|---|---|
| `Codeup: Run Full Scan` | Scan every supported file in the workspace. Modal cost estimate first. |
| `Codeup: Scan Current File` | Scan the file in the active editor only. No cost prompt. |
| `Codeup: Scan Open Tabs` | Scan every file currently open in an editor tab. Cost prompt only if >1 uncached file. |
| `Codeup: Suggest Architectural Intent` | Draft a `.codeup/intent.yaml` from the workspace's directory + dependency layout. |
| `Codeup: Refresh Findings` | Reload findings from disk (use after editing YAML by hand). |
| `Codeup: Focus Findings Panel` | Reveal the Codeup tree view. |
| `Codeup: Group Findings by Severity / Category / Status` | Switch the tree's grouping. |
| `Codeup: Set Anthropic API Key` | Store / replace the API key in `SecretStorage`. |
| `Codeup: Clear Anthropic API Key` | Forget the stored key. |

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

See [`resources/intent.example.yaml`](resources/intent.example.yaml) for a hand-authored example covering the typical domain / application / infrastructure / web layout.

### How to check intent is being obeyed

Layer-rule enforcement runs as part of every scan — no separate command. After `Codeup: Run Full Scan` (or `Codeup: Scan Current File`):

1. The **Codeup** output channel shows `[scan] <root>: deterministic N cycle(s), layer rules applied` once `intent.yaml` has been read.
2. Any forbidden import shows up in the findings tree as a `layer-violation` finding (try `Codeup: Group Findings by Category` if you want to find them at a glance).
3. Each violation is persisted as `.codeup/findings/layer-violation-<hash>.yaml`. Zero API cost — these are computed from the dependency graph plus your rules.

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
npm test                # 74 unit tests via node:test
npm run test:integration # @vscode/test-electron (first run downloads VS Code)
```

Press `F5` in this folder to launch the Extension Development Host with the extension loaded.

See [PLAN.md](PLAN.md) for the implementation roadmap and [TESTING.md](TESTING.md) for the testing strategy.

## Status

Milestones M0–M4 shipped. M5 (CLI / CI / marketplace packaging) is the remaining work.
