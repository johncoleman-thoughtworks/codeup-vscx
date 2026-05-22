// Deterministic file-size check. Catches the "this file is too big to be
// usefully analyzed or maintained" smell without any LLM cost. Two
// thresholds: a configurable warn level, and a critical level tied to
// Codeup's own analysis cap so the tool's limits become visible as
// findings rather than silent skips.

import * as crypto from 'crypto';
import type { Finding } from '../findings/schema';
import type { ProjectIndex } from '../scanner';

const DETECTOR = 'codeup-deterministic';

export interface SizeCheckOptions {
  /** File size in bytes that triggers a medium-severity warning. */
  warnBytes: number;
  /** File size in bytes that triggers a high-severity finding. Files past
   *  this size also exceed the analyzer's character limit, so the LLM pass
   *  skips them — the file size itself becomes the finding. */
  criticalBytes: number;
}

export const DEFAULT_SIZE_OPTIONS: SizeCheckOptions = {
  warnBytes: 30_000,
  criticalBytes: 60_000,
};

// Languages that map to "actual source code" — the only files for
// which oversized-file is meaningful signal. Data formats (yaml / json /
// toml), docs (markdown), and plain text all routinely exceed the warn
// threshold for legitimate reasons (catalogues, schemas, fixtures) and
// flagging them just adds noise to the report. Mirrors the equivalent
// gate in codeup-cli's quality module.
const NON_SOURCE_LANGUAGES = new Set([
  'yaml', 'json', 'toml', 'markdown', 'plaintext', 'html', 'css', 'scss', 'sql',
]);

export function oversizedFiles(index: ProjectIndex, options: SizeCheckOptions = DEFAULT_SIZE_OPTIONS): Finding[] {
  const findings: Finding[] = [];
  for (const file of index.files) {
    if (file.size < options.warnBytes) continue;
    if (NON_SOURCE_LANGUAGES.has(file.language)) continue;
    const isCritical = file.size >= options.criticalBytes;
    const severity: Finding['severity'] = isCritical ? 'high' : 'medium';
    const id = stableId('oversized-file', file.path);
    const now = new Date().toISOString();
    findings.push({
      schemaVersion: 1,
      id,
      category: 'oversized-file',
      severity,
      status: 'unconfirmed',
      priority: severity,
      location: { file: file.path, line: 1, contentHash: file.contentHash },
      explanation: isCritical
        ? `This file is ${file.size.toLocaleString()} bytes — beyond Codeup's ${options.criticalBytes.toLocaleString()}-byte analysis cap. The deep LLM scan was skipped for this file; only deterministic checks ran. The size itself is the finding: at this scale, navigation, code review, merge-conflict surface area, and Codeup's own reasoning quality all suffer.`
        : `This file is ${file.size.toLocaleString()} bytes — past the ${options.warnBytes.toLocaleString()}-byte warning threshold. Navigation, review, and merge-conflict surface area all grow with file size. Consider splitting along natural concern lines before the file grows further.`,
      suggestedRemediation:
        'Split along concern boundaries — distinct classes / responsibilities / aggregates that have grown into one file usually want their own. If this file is generated code or large test fixtures, add it to .gitignore or the scanner exclude list so Codeup stops analyzing it. If the size is deliberate and acceptable, dismiss with a rationale so the knowledge base remembers.',
      detectedAt: now,
      detectedBy: DETECTOR,
      confidence: 1,
      history: [{ timestamp: now, event: 'detected' }],
    });
  }
  return findings;
}

function stableId(category: string, key: string): string {
  const h = crypto.createHash('sha1').update(`${category}:${key}`).digest('hex').slice(0, 12);
  return `${category}-${h}`;
}
