import * as vscode from 'vscode';

/**
 * Translate a VS Code CancellationToken into a Node AbortSignal so it can be
 * passed to the Anthropic SDK (or any other AbortSignal-aware API).
 * Returns the signal plus a dispose function that unhooks the token listener
 * to avoid leaking it once the request settles.
 */
export function abortSignalFor(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const sub = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => sub.dispose() };
}

/** Yield to the event loop so queued microtasks/IO callbacks can run. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
