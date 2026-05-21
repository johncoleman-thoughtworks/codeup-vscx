// Pure cache key composition. Lives apart from cache.ts so unit tests can
// import it without dragging in vscode.
export function analysisCacheKey(contentHash: string, catalogueHash: string, model: string, neighborsKey = ''): string {
  return `${contentHash}:${catalogueHash}:${model}:${neighborsKey}`;
}
