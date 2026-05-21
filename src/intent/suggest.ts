import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicClient } from '../analyzer/client';
import type { DependencyGraph } from '../scanner/graph';
import type { ProjectIndex } from '../scanner';
import { abortSignalFor } from '../util/abort';
import type { IntentConfig, LayerRule } from './layers';
import { formatForPrompt, summarize } from './sampler';

const PROPOSE_LAYER_RULES_TOOL: Anthropic.Tool = {
  name: 'propose_layer_rules',
  description:
    'Propose architectural layer rules for this project. Each layer is identified by a workspace-relative path prefix; cannotDependOn lists the layers this one must not import from. Use 3-6 layers maximum; only include layers that actually exist as paths in the project. Prefer the most conventional naming: domain, application, infrastructure, web/api, ui. If the project has no obvious layered structure, return 1-2 layers covering its dominant source roots and explain in the notes.',
  input_schema: {
    type: 'object',
    properties: {
      layers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            layer: { type: 'string', description: 'Short, lowercase layer name (e.g. "domain", "infrastructure").' },
            match: { type: 'string', description: 'Workspace-relative path prefix that identifies this layer. Must be a directory that exists in the provided summary.' },
            cannotDependOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of other layer names (matching the layer field above) this layer must not import from.',
            },
          },
          required: ['layer', 'match', 'cannotDependOn'],
        },
      },
      notes: { type: 'string', description: 'Optional short explanation of the reasoning. Surfaced as a YAML comment in the generated file.' },
    },
    required: ['layers'],
  },
};

export interface SuggestionResult {
  intent: IntentConfig;
  notes?: string;
  yaml: string;
}

export async function suggestIntent(
  index: ProjectIndex,
  graph: DependencyGraph,
  client: AnthropicClient,
  token?: vscode.CancellationToken,
): Promise<SuggestionResult> {
  const summary = summarize(index, graph);
  const userPrompt = formatForPrompt(summary);

  const anthropic = await client.ensure();
  const abort = token ? abortSignalFor(token) : undefined;
  try {
    const response = await anthropic.messages.create(
      {
        model: client.model(),
        max_tokens: 1500,
        system: buildSystemPrompt(),
        tools: [PROPOSE_LAYER_RULES_TOOL],
        messages: [{ role: 'user', content: userPrompt }],
      },
      abort ? { signal: abort.signal } : undefined,
    );

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'propose_layer_rules') {
        const input = block.input as { layers?: LayerRule[]; notes?: string };
        const layers = (input.layers ?? []).filter(isValidLayer);
        const intent: IntentConfig = { layers };
        return { intent, notes: input.notes, yaml: renderYaml(intent, input.notes) };
      }
    }
    throw new Error('Claude did not call the propose_layer_rules tool');
  } finally {
    abort?.dispose();
  }
}

function buildSystemPrompt(): string {
  return [
    'You are a software architect. You will be given a compressed summary of a project (top directories by file count + the most-frequent cross-directory imports) and asked to draft architectural layer rules for it.',
    'Goal: a small, useful starting point for the team to edit — not an exhaustive description.',
    'Conventions to recognise (any language):',
    '- Domain / business core (model, domain, core)',
    '- Application / use-cases (application, services, use-cases, usecases, handlers)',
    '- Infrastructure / persistence (infrastructure, persistence, repository, repositories, adapters, dao, db)',
    '- Web / API / transport (web, api, http, controllers, controller, routes, endpoints, rest)',
    '- UI / views (ui, views, components, pages, templates, frontend)',
    'Rules of thumb for cannotDependOn:',
    '- domain should not depend on any of infrastructure, web/api, ui',
    '- application should not depend on web/api or ui',
    '- infrastructure should not depend on web/api or ui',
    'Match strings are minimatch globs against the workspace-relative path. Use plain directory prefixes (e.g. `src/main/java/com/example/domain/`) for normal projects. For monorepos with a `packages/` or `apps/` parent containing peer projects, use a wildcard segment (e.g. `packages/*/src/**/domain/**`) so one rule applies to every package at once.',
    'Only emit layers whose match (interpreted as a glob) covers directories that appear in the provided summary. Use 3-6 layers max.',
    'If the project does not show a clear layered structure, return 1-2 layers and explain in notes that the team should refine manually.',
    'Emit exactly one call to the propose_layer_rules tool. Do not narrate.',
  ].join('\n');
}

function isValidLayer(l: unknown): l is LayerRule {
  if (!l || typeof l !== 'object') return false;
  const r = l as Record<string, unknown>;
  if (typeof r.layer !== 'string' || !r.layer) return false;
  if (typeof r.match !== 'string' || !r.match) return false;
  if (!Array.isArray(r.cannotDependOn)) return false;
  if (!r.cannotDependOn.every((x) => typeof x === 'string')) return false;
  return true;
}

export function renderYaml(intent: IntentConfig, notes?: string): string {
  const header = [
    '# Generated by Codeup as a starting point — edit to match your team\'s actual',
    '# architectural rules. Layer matches are path prefixes; cannotDependOn lists',
    '# other layer names this layer must not import from.',
  ];
  if (notes) {
    header.push('#');
    for (const line of notes.split('\n')) header.push(`# ${line}`);
  }
  header.push('');
  return header.join('\n') + yaml.dump(intent, { lineWidth: 100, noRefs: true });
}
