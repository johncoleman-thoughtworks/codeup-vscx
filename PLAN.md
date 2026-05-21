# Codeup — Implementation Plan

Five components from the design doc: **scanner**, **analyzer**, **findings store**, **VS Code UI**, **knowledge base**. Sequenced into five milestones so each one ships something usable on its own.

## Milestone 0 — Scaffold (done)

- TypeScript VS Code extension manifest, build config, launch config.
- Activity-bar container + tree view stub (`codeup.findings`).
- Command palette entries: full scan, file scan, refresh.
- Settings: model, scan-on-save, findings dir.

**Verify:** `npm install && npm run compile`, then `F5` → "Codeup" appears in the activity bar with an empty findings panel.

## Milestone 1 — Findings store + tree view (1–2 weeks)

Goal: end-to-end UX with hand-authored findings, no LLM yet.

- [ ] `src/findings/schema.ts` — TypeScript types + zod validation for the YAML schema in the design doc (id, category, severity, status, location, history, etc.).
- [ ] `src/findings/store.ts` — load/save findings from `.codeup/findings/*.yaml`; `FileSystemWatcher` to refresh on external changes.
- [ ] `FindingsProvider` — group by severity or category (user toggle), show counts, click-to-open with `revealRange`.
- [ ] Details webview — render explanation + remediation as markdown; action buttons for confirm / dismiss / change priority / mark fixed.
- [ ] Editor decorations — gutter icon + squiggle on lines tied to a finding for the active file.
- [ ] Hover provider — summary tooltip linking to details view.
- [ ] Status bar item — total finding count + scan state.
- [ ] Hand-author 5–10 example findings against this repo to dogfood.

**Verify:** open repo with sample findings → tree view populated, click navigates, dismiss updates YAML, file watcher reflects external edits.

## Milestone 2 — Scanner + single-file analyzer (2 weeks)

Goal: Claude actually finds things inside individual files.

- [ ] `src/scanner/index.ts` — walk workspace respecting `.gitignore` + configurable excludes; emit `ProjectIndex` (path, language, size, content hash, exported/imported symbols).
- [ ] Persist index to `.codeup/index/index.json`; incremental updates keyed by content hash.
- [ ] `src/catalogue/default.yaml` — seed 20–30 anti-patterns (anemic domain model, god class, primitive obsession, feature envy, etc.) with language tags + detection hints.
- [ ] `src/analyzer/client.ts` — Anthropic SDK wrapper, API key from `SecretStorage`, model from settings, retry/backoff.
- [ ] Tool-use schema: `report_finding` tool enforced via the SDK's tool definitions (no prose parsing).
- [ ] Pass 1 (triage) + Pass 3 (deep) for single files; skip Pass 2 cross-file for now.
- [ ] Hash-based cache so unchanged files are not re-analyzed.
- [ ] `codeup.scan.file` and `codeup.scan.full` wired up; progress via `withProgress`.
- [ ] Cost estimator surfaced before a full scan runs.

**Verify:** scan a small TS project → findings appear in the tree, statuses persist across reloads, second scan with no changes makes zero API calls.

## Milestone 3 — Dependency graph + cross-file analysis (done)

Goal: catch shotgun surgery, divergent change, leaky abstraction, cyclic dependencies.

- [x] Per-language regex-based import extraction (Java, Kotlin, Scala, TS/JS, Python, Go, C#) — tree-sitter deferred.
- [x] `src/scanner/graph.ts` — module dependency graph + Tarjan SCC cycle detection.
- [x] Deterministic checks (no LLM): cycle detection, layer-violation rules from `.codeup/intent.yaml`.
- [x] Cross-file LLM context: neighbor files (importers + imported) included in single-file analysis prompt.
- [x] Finding locations include content hash; rebind step on rescan when files move.
- [x] Orphaned-findings group in tree view.
- [ ] Tree-sitter integration (deferred — regex import extraction is good enough for the patterns we have).
- [ ] AST path stability (deferred — content hash + line works for now).

**Verify:** introduce a cycle into a sample project → flagged without an API call; rename a file with a confirmed finding → finding rebinds, history records the move.

## Milestone 4 — Knowledge base + feedback loop (done)

Goal: tool improves over time on each codebase.

- [x] `.codeup/knowledge/` layout: `dismissals.yaml`, `exemplars.yaml`, `patterns.yaml` (team-specific catalogue extensions).
- [x] Dismiss-with-rationale persists a `DismissalEntry`; confirm persists an `ExemplarEntry`.
- [x] In-memory retrieval by minimatch glob (dismissals) and directory proximity (exemplars); top-K per category.
- [x] Analyzer prompts include retrieved knowledge entries as a "Project conventions" block.
- [x] Custom catalogue patterns merge over defaults; cache key includes knowledge hash so changes invalidate stale results.
- [ ] Vector similarity / dense retrieval — deferred until in-memory retrieval feels insufficient.
- [ ] "Why was this not flagged again?" UI link — the finding history table already shows the dismissal event; deferred upgrade.

**Verify:** dismiss a finding with rationale → next scan does not re-flag it; confirm a finding → next scan flags structurally-similar code with higher confidence.

## Milestone 5 — Polish + CI (1–2 weeks)

- [ ] Scan profiles (quick / deep) with cost estimates.
- [ ] Scheduled scans (workspace-level cron).
- [ ] `codeup` CLI entrypoint for CI; same analyzer, output as a PR comment + SARIF.
- [ ] GitHub Action recipe in `examples/`.
- [ ] Telemetry opt-in (counts only — no code, no findings content).
- [ ] Marketplace packaging (`vsce package`) + signing.

## Cross-cutting concerns

- **API key storage** — `vscode.SecretStorage` only; never settings.json. First-run prompt to set it.
- **Background work** — analyzer in a worker thread; never block the extension host.
- **Schema migrations** — `schemaVersion` field on every YAML file; migration runner on extension activation.
- **Testing** — `@vscode/test-electron` for activation + tree-view smoke tests; analyzer tested against recorded API fixtures (no live calls in CI).
- **Linting** — eslint + prettier; add in M1.

## Open questions

1. JetBrains port — same shape via IntelliJ Platform SDK, or skip for now?
2. Multi-root workspaces — one findings dir per root, or merged view?
3. Monorepo scale — at >5k files, does the in-memory project index need to spill to sqlite?
4. License — internal tool, OSS, or commercial?
