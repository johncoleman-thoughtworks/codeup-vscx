import type Anthropic from '@anthropic-ai/sdk';

export const REPORT_FINDING_TOOL: Anthropic.Tool = {
  name: 'report_finding',
  description:
    'Report a single architectural anti-pattern finding in the file under review. Call once per distinct issue. Do not call for stylistic nitpicks, formatting, or generic improvement suggestions — only for issues that match a catalogue pattern with reasonable confidence.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Pattern id from the provided catalogue (e.g. "anemic-domain-model").',
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Severity. Default to the catalogue pattern severity unless this instance is meaningfully worse or milder.',
      },
      line: {
        type: 'integer',
        description: '1-based starting line of the offending region.',
      },
      endLine: {
        type: 'integer',
        description: '1-based ending line (inclusive). Equal to line if a single line.',
      },
      explanation: {
        type: 'string',
        description: 'Why this is an instance of the pattern, written for a developer reading their own code. 2–5 sentences. No filler.',
      },
      suggestedRemediation: {
        type: 'string',
        description: 'Concrete fix direction. Optional but encouraged.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in [0, 1] that this is a real instance of the named pattern. 0.9 = textbook example you would defend in code review. 0.5 = plausible, depends on intent. 0.3 = worth a developer eyeballing. This is metadata for the reviewer; it is NOT a gate — always emit the tool call, never withhold a finding because confidence is low.',
      },
    },
    required: ['category', 'severity', 'line', 'explanation', 'confidence'],
  },
};

export interface ReportedFinding {
  category: string;
  severity: 'low' | 'medium' | 'high';
  line: number;
  endLine?: number;
  explanation: string;
  suggestedRemediation?: string;
  confidence: number;
}
