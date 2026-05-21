# Codeup — Implementation Plan

Five components from the design doc: **scanner**, **analyzer**, **findings store**, **VS Code UI**, **knowledge base**. Sequenced into five milestones so each one ships something usable on its own.

## Milestone 0 — Scaffold (done)

- TypeScript VS Code extension manifest, build config, launch config.
- Activity-bar container + tree view stub (`codeup.findings`).
- Command palette entries: full scan, file scan, refresh.
- Settings: model, scan-on-save, findings dir.

## Milestone 1 — Findings store + tree view (done)

End-to-end UX with hand-authored findings, no LLM yet.

- [x] Finding schema (`src/findings/schema.ts`) with hand-rolled validator.
- [x] `FindingsStore` — load/save `.codeup/findings/*.yaml`, `FileSystemWatcher`, status/priority history.
- [x] `FindingsProvider` tree view — group by severity / category / status; click to open.
- [x] Details webview — markdown explanation + remediation, Confirm / Dismiss… / Mark Fixed / Reopen actions; buttons reflect current status; no-op status transitions are skipped.
- [x] Editor decorations — whole-line backgrounds, overview-ruler marks, hover provider with command link to the details view.
- [x] Status-bar item — open count, high-severity badge, scan-state spinner.
- [x] Hand-authored dogfood findings under `.codeup/findings/`.

## Milestone 2 — Scanner + single-file analyzer (done)

Claude actually finds things inside individual files.

- [x] `src/scanner/index.ts` — workspace walker honouring `.gitignore` + language-aware default excludes (Node, JVM/Gradle/Maven/Kotlin, Go, .NET, Python). 512 KB per-file cap.
- [x] `src/scanner/persist.ts` — `.codeup/index/index.json` + `.codeup/index/graph.json`.
- [x] `resources/catalogue/default.yaml` — initially 30 patterns; later expanded to 90 (Fowler / Brown / Halloway / exception-handling / DDD / data / process).
- [x] `src/analyzer/client.ts` — Anthropic SDK wrapper, key from `SecretStorage`, model from settings.
- [x] `report_finding` tool with strict JSON schema; tool-use loop, no prose parsing.
- [x] Hash-keyed analysis cache `<contentHash>:<catalogueHash>:<model>:<neighborsKey>:<knowledgeKey>` → repeat scan with no changes makes zero API calls.
- [x] `codeup.scan.file` and `codeup.scan.full` wired through `withProgress`; cost estimator modal before full scans.
- [x] Confidence reported by the model is advisory (no drop gate); prompt explicitly tells the model never to use confidence as a gate.

## Milestone 3 — Dependency graph + cross-file analysis (done)

Catch shotgun surgery, divergent change, leaky abstraction, cyclic dependencies.

- [x] Per-language regex-based import extraction (Java, Kotlin, Scala, TS/JS, Python, Go, C#) — tree-sitter deferred.
- [x] `src/scanner/graph.ts` — module dependency graph + Tarjan SCC cycle detection.
- [x] Deterministic checks (no LLM): cyclic-dependency, layer-violation driven by `.codeup/intent.yaml`.
- [x] Cross-file LLM context: up to 6 neighbor files (importers + imported) injected; cache key includes a neighbors hash.
- [x] Finding rebinding on file moves via content-hash match; orphaned-findings group in the tree view.
- [ ] Tree-sitter integration (deferred — regex import extraction is good enough for the patterns we have).
- [ ] AST-path-stable finding pointers (deferred — content hash + line works for now).

## Milestone 4 — Knowledge base + feedback loop (done)

Tool improves over time on each codebase.

- [x] `.codeup/knowledge/` layout: `dismissals.yaml`, `exemplars.yaml`, `patterns.yaml` (team-specific catalogue extensions).
- [x] Dismiss-with-rationale persists a `DismissalEntry`; confirm persists an `ExemplarEntry`.
- [x] In-memory retrieval — minimatch glob (dismissals) + directory proximity (exemplars); top-K per category.
- [x] Analyzer prompts include retrieved knowledge as a "Project conventions" block.
- [x] Custom catalogue patterns merge over defaults; cache key includes knowledge hash so changes invalidate stale results.
- [ ] Vector similarity / dense retrieval — deferred until in-memory retrieval feels insufficient.

## Bonus — beyond the original plan (done)

Features that emerged through dogfooding and weren't in the original sequencing:

- [x] **LLM-drafted intent.yaml** — `Codeup: Suggest Architectural Intent` command. Compresses the directory layout + dependency graph into a small summary, asks Claude to propose layer rules via the `propose_layer_rules` tool, writes `.codeup/intent.yaml` (or opens as an untitled buffer if the file exists).
- [x] **Multi-root workspaces** — `WorkspaceStores` holds one `FindingsStore` + `KnowledgeStore` per workspace folder; state lives per-root on disk; tree view groups by root when count > 1; scan runner iterates roots end-to-end.
- [x] **Monorepo glob match** — `intent.yaml` `match` field is a minimatch glob (trailing-slash prefixes auto-extend to `**`); a single rule like `packages/*/src/**/domain/**` covers every package's domain.
- [x] **Per-entry analysis cache** — `.codeup/cache/entries/<hash>.json`, lazy-loaded; legacy `analysis.json` migrated automatically. Scales to large monorepos without parsing a giant blob on every scan.
- [x] **Self-ignoring generated dirs** — Codeup drops a `.gitignore` inside `.codeup/index/` and `.codeup/cache/` so contents are git-ignored even without a project-level entry.
- [x] **Custom `{^}` icon** in the activity bar.

## Milestone 5 — Polish + CI (not started)

- [ ] Scan profiles (quick / deep) with separate cost estimates.
- [ ] Scheduled scans (workspace-level cron).
- [ ] `codeup` CLI entry point for CI; same analyzer, output as a PR comment + SARIF.
- [ ] GitHub Action recipe in `examples/`.
- [ ] Telemetry opt-in (counts only — no code, no findings content).
- [ ] Marketplace packaging (`vsce package`) + signing.

## Cross-cutting concerns

- **API key storage** — done. `vscode.SecretStorage` only; never settings.json. First-run prompt set.
- **Background work** — done at current scale. Anthropic SDK calls receive an `AbortSignal` derived from the progress notification's `CancellationToken`, so Cancel actually interrupts in-flight requests. The per-file loop yields to the event loop between iterations. True worker-thread offloading deferred until profiling on a 10k+ file repo shows the need.
- **Schema migrations** — done. `src/migrations/runner.ts` provides a generic `runMigrations` that chains v1 → v2 → … → current. Registries declared per artifact (`FINDING_MIGRATIONS`, `DISMISSAL_MIGRATIONS`, etc.); all currently empty because every schema is still at v1. `FindingsStore` and `KnowledgeStore` both pass loaded YAML through the runner before validation.
- **Testing** — 74 unit tests passing (`npm test`); `@vscode/test-electron` activation suite scaffolded but never live-run (downloads VS Code on first invocation). No recorded API fixtures yet.
- **Linting** — not done. `eslint` referenced in `package.json` scripts but no config file yet.

## Open questions

1. JetBrains port — same shape via IntelliJ Platform SDK, or skip for now?
2. ~~Multi-root workspaces — one findings dir per root, or merged view?~~ **Decided & shipped**: per-root state on disk + merged tree in the UI.
3. ~~Monorepo scale — at >5k files, does the in-memory project index need to spill to sqlite?~~ **Decided & shipped**: analysis cache split into one file per entry; index/graph remain in-memory JSON. SQLite revisit only if Windows AV makes file-per-entry painful in practice.
4. License — internal tool, OSS, or commercial?
