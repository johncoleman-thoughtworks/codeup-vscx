# Changelog

All notable changes to Codeup are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Codeup uses [Semantic Versioning](https://semver.org/).

## 1.0.1 — 2026-05-21

### Fixed

- `non-exclusive-subtypes` was not firing on real codebases after the
  catalogue was genericized in 1.0.0. The previous hint relied on a
  single example as the textual anchor for Claude's reasoning; once
  the example was stripped to keep the catalogue project-neutral,
  detection collapsed. Hint rewritten with six varied concrete examples
  (Person/Employee/Customer, Vehicle/Cargo/Passenger, Account/Savings/
  Checking, Outlet/Restaurant/GroceryStore, Building/Residential/
  Commercial, User/Author/Reviewer) plus an explicit "always apply this
  check when extends/implements is present" instruction and a mandatory
  reasoning step.
- Cross-file context was invisible for JVM and C# files that
  reference siblings within the same package (no explicit `import`).
  Same-package siblings are now included as `samePackage` neighbors,
  filling any spare slots after the import-graph picks. Without this,
  inheritance-shaped patterns like `non-exclusive-subtypes` had no way
  to see the sibling subclasses.

### Tweaked

- `displayName` description trimmed to "Coding anti-pattern findings…".

## 1.0.0 — 2026-05-21

First public release. Surfaces architectural anti-patterns in your codebase, powered by the Anthropic API, with findings persisted as YAML files under `.codeup/` so they travel with the repo and accumulate the team's decisions.

### Catalogue

- 91 anti-patterns spanning code smells (Fowler, Brown et al.), Halloway's 10 ways to add complexity, exception-handling pitfalls, coupling/cohesion, service-level architecture (DDD-aware), data/persistence (N+1, lost updates, EAV, god tables), and process/judgement smells (premature optimisation, golden hammer, lava flow).

### Scanning

- Workspace scanner honouring `.gitignore` plus language-aware default excludes (Node, JVM/Gradle/Maven/Kotlin, Go, .NET, Python).
- Regex-based import extraction for Java, Kotlin, Scala, TS/JS, Python, Go, C#.
- Dependency graph with Tarjan SCC cycle detection.
- Three scan scopes: `Codeup: Run Full Scan`, `Codeup: Scan Current File`, `Codeup: Scan Open Tabs`.
- Cancel mid-scan actually interrupts in-flight Anthropic requests via `AbortSignal`.

### Deterministic checks (no API cost)

- `cyclic-dependency` findings from SCCs in the import graph.
- `layer-violation` findings driven by an optional `.codeup/intent.yaml`.
- `Codeup: Suggest Architectural Intent` drafts a starter `intent.yaml` by sampling the workspace structure + graph and asking Claude for layer rules.
- Layer rules accept minimatch globs (e.g. `packages/*/src/**/domain/**`) so one rule covers every package in a monorepo.

### Knowledge base

- Dismiss-with-rationale persists a `DismissalEntry` to `.codeup/knowledge/dismissals.yaml`; future scans see the rationale in the prompt.
- Confirm persists an `ExemplarEntry` to `.codeup/knowledge/exemplars.yaml` as a positive example.
- Custom catalogue extensions: `.codeup/knowledge/patterns.yaml` overrides defaults by id.
- Retrieval matches dismissals via glob, exemplars via directory proximity.

### UI

- Findings tree grouped by severity / category / status, with per-root grouping in multi-root workspaces.
- Details webview with markdown explanation + remediation; action buttons (Confirm / Dismiss… / Mark Fixed / Reopen) reflect current status; dismissed findings disappear from the default view but stay on disk.
- Editor decorations + hover provider with command links into the details view.
- Status bar showing open finding count + scan-state spinner.
- Custom `{^}` activity-bar icon.

### Workspaces & scale

- Multi-root workspaces: each root keeps its own `.codeup/` on disk; the UI shows a merged tree.
- Analysis cache split into one file per entry under `.codeup/cache/entries/<hash>.json`. Lazy-loaded; legacy `analysis.json` migrated automatically.
- `.codeup/index/` and `.codeup/cache/` self-ignore — Codeup writes a local `.gitignore` so generated state never gets committed even without a project-level entry.

### Storage & safety

- Anthropic API key stored exclusively in VS Code `SecretStorage` (macOS Keychain / Windows DPAPI / Linux libsecret).
- Findings, knowledge entries, custom patterns, and intent rules all carry `schemaVersion` and run through a generic migration runner on load.

### Testing

- 74 unit tests (`npm test`) covering schema, import extraction, graph + cycles, layer matching (incl. monorepo globs), cache keys, workspace-store routing, migration runner, knowledge retrieval, intent sampler.
- `@vscode/test-electron` activation suite scaffolded under `src/test/integration/`.
