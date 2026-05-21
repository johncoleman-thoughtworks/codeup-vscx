# Testing Codeup

Three layers, runnable independently.

## Unit tests (`npm test`)

Fast, no VS Code launch, no API calls. Built on `node:test` + `node:assert/strict`. Cover the pure pieces:

| File | What it tests |
|---|---|
| [src/test/unit/schema.test.ts](src/test/unit/schema.test.ts) | `validateFinding` happy path, missing fields, bad enums, location requirements |
| [src/test/unit/imports.test.ts](src/test/unit/imports.test.ts) | Per-language import extraction (Java, TS/JS, Python, Go) |
| [src/test/unit/graph.test.ts](src/test/unit/graph.test.ts) | `buildGraph` resolution (Java, TS); `findCycles` for cycles / DAG / disjoint cycles / self-loop filtering |
| [src/test/unit/layers.test.ts](src/test/unit/layers.test.ts) | `layerForFile` longest-prefix matching |
| [src/test/unit/intent-check.test.ts](src/test/unit/intent-check.test.ts) | `cycleFindings` shape + stable ids; `layerViolations` allowed/forbidden directions |
| [src/test/unit/analyzer-pure.test.ts](src/test/unit/analyzer-pure.test.ts) | `stableId` determinism; `neighborsCacheKey` order-independence; `validateReported` happy/sad paths |

```bash
npm test            # compile + run unit tests (default)
npm run test:unit   # if you've already compiled
```

## Integration test (`npm run test:integration`)

Uses `@vscode/test-electron` to launch a real VS Code with a fixture workspace and exercise the extension end-to-end.

First run downloads a VS Code binary (~100 MB) into `.vscode-test/`. Subsequent runs are fast.

[src/test/integration/suite/activation.test.ts](src/test/integration/suite/activation.test.ts) covers:

- Extension is present and activates
- Required commands are registered (`codeup.findings.refresh`, `codeup.scan.full`, `codeup.scan.file`)
- The fixture finding under `.codeup/findings/` is readable

```bash
npm run test:integration
npm run test:all    # unit + integration
```

## Manual smoke test (the Java sample)

Anything UI-shaped that the integration suite doesn't cover. Roughly:

1. Open the Java sample workspace in the Extension Development Host (F5 from the Codeup project).
2. `Codeup: Set Anthropic API Key`.
3. `Codeup: Run Full Scan` → expect deterministic findings (cycles, layer violations if `.codeup/intent.yaml` is configured) plus LLM findings.
4. Click a finding → editor opens at the right line, details webview shows explanation.
5. Dismiss with rationale → YAML updates on disk; history event recorded.
6. Move a file with a finding attached → rescan → finding rebinds (history shows `rebound`).
7. Delete the file → rescan → finding moves under the "orphaned" group.

## Things the suite deliberately does NOT cover

- **Live Anthropic calls** — too expensive and flaky for CI. The pure pieces of the analyzer (`validateReported`, `stableId`, `neighborsCacheKey`) are unit-tested; the orchestration (`analyzeFile`) is exercised manually.
- **Tree-view rendering** — the tree provider's tree state isn't asserted; that's covered by the manual smoke test.
- **Cost estimation accuracy** — heuristic; not worth pinning.
