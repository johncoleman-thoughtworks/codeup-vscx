# Changelog

All notable changes to Codeup are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Codeup uses [Semantic Versioning](https://semver.org/).

## 1.1.0 — 2026-05-22

### Added

- **GitHub Copilot as a model provider.** Codeup can now route through
  VS Code's Language Model API (`vscode.lm`) using a Copilot
  subscription instead of a direct Anthropic API key. Useful for
  client engagements where Copilot is already procured and approved
  but an Anthropic account is not. No API key needed; first run
  prompts once for VS Code permission to use the language model.
- New `codeup.modelProvider` setting: `"auto"` (default — Anthropic
  if a key is set, falls back to Copilot), `"anthropic"`, or
  `"copilot"`.
- Active provider + model + selection reason are logged to the
  Codeup output channel at the start of every scan.
- Cost-prompt modal is now provider-aware — shows a dollar estimate
  for Anthropic, a Copilot-quota estimate for Copilot.

### Internal

- New `LLMClient` interface abstracts the analyzer's LLM call.
  `AnthropicClient` (existing) and `VSCodeLMClient` (new) both
  implement it. `ProviderFactory` resolves the right one based on
  the setting and credential availability.
- `analyzer/analyze.ts`, `scan/runner.ts`, and `intent/suggest.ts`
  all switched from concrete `AnthropicClient` to the `LLMClient`
  interface. No detection-quality change for existing Anthropic users.

### Caveats

- **The Copilot path is new in 1.1.0 and has not been verified
  end-to-end on a real codebase yet.** Tool-use round-trips through
  GitHub's proxy *should* work — the wiring is straightforward — but
  some catalogue patterns may degrade vs Anthropic direct if the
  proxy reshapes tool-call schemas. File an issue if you see this;
  expect a 1.1.x patch tightening the path against real-world results.
- Organisational policy can disable third-party extension access to
  the Language Model API. If that's set, the Copilot path is closed
  without an admin change — Codeup's error message points to this as
  the likely cause.

## 1.0.5 — 2026-05-22

### Added

- New catalogue entry `oversized-file` — deterministic check (no LLM)
  flagging files past a configurable size threshold. Medium severity at
  the warn level (default 30,000 bytes — navigation, review, merge
  surface area suffer); high severity at the critical level (default
  60,000 bytes, matching the analyzer's character cap — files beyond
  this are silently skipped by the LLM pass, and now the size itself
  surfaces as the finding). Makes Codeup's own analysis limits visible
  as code quality signals rather than hidden behaviour.
- Two new settings: `codeup.fileSize.warnBytes` and
  `codeup.fileSize.criticalBytes` for tuning the thresholds.

Catalogue now at 96 patterns; 4 are deterministic (`cyclic-dependency`,
`layer-violation`, `oversized-file`, plus `cyclic-dependency-risk` LLM
hint).

## 1.0.4 — 2026-05-22

### Added

- Marketplace icon (`resources/codeup-marketplace.png`) — 128×128
  rounded-square with the `{^}` glyph in white on VS Code blue. Set as
  `icon` in `package.json` so the Extensions sidebar / .vsix install
  page no longer shows the generic placeholder.

### Fixed

- Activity-bar `{^}` glyph re-spaced to match the marketplace icon's
  proportions. Previous version's compression at activity-bar render
  size made the braces and caret crowd each other.

### Docs

- README now includes a **Data handling** section spelling out what
  Codeup sends to the Anthropic API (full file text + neighbor files
  + knowledge entries) and what it does not (gitignored files,
  oversize files, cache-hit files, deterministic findings). Includes
  guidance for client-confidential code: Zero Data Retention with
  Anthropic, Bedrock / Vertex routing as future options, or
  deterministic-only mode (planned `codeup.scan.deterministicOnly`
  setting).

## 1.0.3 — 2026-05-21

### Added

Three new catalogue entries drawn from Robert C. Martin's *Clean Code*
(Ch. 17) and Sonar's cognitive-complexity concept:

- `base-class-depends-on-subclass` — flags parent classes that
  reference their concrete subclasses (`instanceof`, downcasts,
  direct construction, calls to subclass-specific methods via cast).
  Distinct from `cyclic-dependency` (which is about module imports);
  this is the OO-shape version. Carries an explicit excuse for
  sealed/exhaustive-match hierarchies and the Visitor pattern.
- `function-name-mismatch` — function does meaningfully more or less
  than the name promises (`get*` that also creates, `validate*` that
  also mutates, `save*` that also publishes events). Reasoning step
  forces Claude to read the name aloud and list what the body does
  before reporting.
- `cognitive-complexity` — captures the combinatorial case where
  multiple control-flow shapes, nested decisions, and boolean
  operators stitched into conditions multiply each other into a
  function that is hard to follow even when not very long. Distinct
  from `long-method` (size) and `deep-nesting` (depth).

Catalogue now at 95 patterns.

### Docs

- README "What it detects" updated with the new entries and a new
  "Inheritance & OO shape" category.

## 1.0.2 — 2026-05-21

### Added

- New catalogue entry `procedural-shell-class` — flags classes with
  verb-as-noun suffixes (Manager / Handler / Processor / Helper /
  Coordinator / Executor / Worker / Doer / Utility) whose body is
  procedural code that should live on a domain object. Includes
  explicit "do NOT report" guards for framework callback interfaces
  (Spring HandlerInterceptor, AWS Lambda RequestHandler, JavaFX
  EventHandler, Akka Actor), application-service classes in an
  explicit DDD application layer, stateless CQRS dispatchers, and
  genuine cross-aggregate orchestration. Mandatory reasoning step:
  name the dominant entity the methods operate on; only report if the
  behaviour would naturally live there.

  Catalogue now at 92 patterns.

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
