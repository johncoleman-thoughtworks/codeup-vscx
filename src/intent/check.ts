import * as crypto from 'crypto';
import { Finding } from '../findings/schema';
import { DependencyGraph, Cycle } from '../scanner/graph';
import { IntentConfig, layerForFile } from './loader';

const DETECTOR = 'codeup-deterministic';

export function cycleFindings(cycles: Cycle[]): Finding[] {
  return cycles.map((cycle) => {
    const head = cycle.files[0];
    const id = stableId('cyclic-dependency', cycle.files.join('|'));
    const isSelf = cycle.files.length === 1;
    const explanation = isSelf
      ? `${head} imports from itself (transitive self-loop in the module graph).`
      : `Cyclic import chain across ${cycle.files.length} files:\n\n${[...cycle.files, cycle.files[0]].join(' → ')}\n\nCycles make these files impossible to reason about or test in isolation; usually signals a missing abstraction that wants to live in a separate module.`;
    return baseFinding({
      id,
      category: 'cyclic-dependency',
      severity: 'high',
      file: head,
      explanation,
      remediation:
        'Extract the shared concept into a third module that both can depend on, or invert the dependency direction so the lower-level module no longer reaches into the higher-level one.',
    });
  });
}

export function layerViolations(graph: DependencyGraph, intent: IntentConfig): Finding[] {
  const findings: Finding[] = [];
  for (const [from, targets] of graph.edges) {
    const fromLayer = layerForFile(from, intent);
    if (!fromLayer) continue;
    const rule = intent.layers.find((l) => l.layer === fromLayer);
    if (!rule || rule.cannotDependOn.length === 0) continue;
    for (const to of targets) {
      const toLayer = layerForFile(to, intent);
      if (!toLayer) continue;
      if (!rule.cannotDependOn.includes(toLayer)) continue;
      const id = stableId('layer-violation', `${from}->${to}`);
      findings.push(
        baseFinding({
          id,
          category: 'layer-violation',
          severity: 'high',
          file: from,
          explanation: `Layer "${fromLayer}" (${from}) imports from layer "${toLayer}" (${to}). Configured intent in .codeup/intent.yaml prohibits this direction.`,
          remediation:
            `Move the shared abstraction down into a layer that "${fromLayer}" is allowed to depend on, or invert the call via an interface defined in "${fromLayer}" and implemented in "${toLayer}".`,
        }),
      );
    }
  }
  return findings;
}

function baseFinding(opts: {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
  file: string;
  explanation: string;
  remediation: string;
}): Finding {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: opts.id,
    category: opts.category,
    severity: opts.severity,
    status: 'unconfirmed',
    priority: opts.severity,
    location: { file: opts.file },
    explanation: opts.explanation,
    suggestedRemediation: opts.remediation,
    detectedAt: now,
    detectedBy: DETECTOR,
    confidence: 1,
    history: [{ timestamp: now, event: 'detected' }],
  };
}

function stableId(category: string, key: string): string {
  const h = crypto.createHash('sha1').update(`${category}:${key}`).digest('hex').slice(0, 12);
  return `${category}-${h}`;
}
