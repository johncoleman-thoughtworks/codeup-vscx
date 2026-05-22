// LLMClient backed by VS Code's Language Model API (vscode.lm). Uses the
// user's Copilot subscription as the credential and routes through GitHub's
// proxy. The first request prompts the user once to grant Codeup permission.
//
// Limitations vs Anthropic direct:
//   - Available model versions depend on what Copilot exposes; family is
//     'claude-3.5-sonnet' / 'claude-sonnet-4' style ids, not exact dotted
//     versions.
//   - Some organisations disable third-party extension access to the LM
//     API. If so, selectChatModels returns an empty array and we raise a
//     clear error pointing at the org-policy as the likely cause.
//   - Tool-use round-trips through GitHub's proxy; the JSON schema is
//     translated to LanguageModelChatTool. Verified for report_finding.

import * as vscode from 'vscode';
import type { LLMAnalyzeRequest, LLMAnalyzeResponse, LLMClient, ProviderName } from './llm';

const PREFERRED_FAMILIES = [
  'claude-sonnet-4',
  'claude-3.5-sonnet',
  'claude-opus-4',
];

export class VSCodeLMClient implements LLMClient {
  private cached: { model: vscode.LanguageModelChat; family: string } | undefined;

  provider(): ProviderName {
    return 'copilot';
  }

  model(): string {
    return this.cached ? `copilot/${this.cached.family}` : 'copilot/auto';
  }

  reset(): void {
    this.cached = undefined;
  }

  async analyze(req: LLMAnalyzeRequest): Promise<LLMAnalyzeResponse> {
    const { model } = await this.ensure();

    const tool: vscode.LanguageModelChatTool = {
      name: req.tool.name,
      description: req.tool.description,
      inputSchema: req.tool.input_schema,
    };

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(`${req.systemPrompt}\n\n${req.userPrompt}`),
    ];

    const cancellation = req.token ?? new vscode.CancellationTokenSource().token;
    const response = await model.sendRequest(
      messages,
      { tools: [tool], toolMode: vscode.LanguageModelChatToolMode.Auto },
      cancellation,
    );

    const toolCalls: { name: string; input: unknown }[] = [];
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({ name: part.name, input: part.input });
      }
      // Text parts ignored — Codeup never reads prose output from the model;
      // findings are only ever delivered as tool calls.
    }
    return { toolCalls };
  }

  /** Returns true if the user has any Copilot chat model available. Does NOT
   *  trigger the consent prompt — that happens on first analyze() call. */
  async hasCredentials(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  private async ensure(): Promise<{ model: vscode.LanguageModelChat; family: string }> {
    if (this.cached) return this.cached;
    // Try each preferred family in order; fall back to whatever the user has.
    for (const family of PREFERRED_FAMILIES) {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
      if (models.length > 0) {
        this.cached = { model: models[0], family };
        return this.cached;
      }
    }
    const any = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (any.length === 0) {
      throw new Error(
        'No Copilot chat models are available. Likely causes: (1) GitHub Copilot is not signed in (sign in via the Copilot extension), (2) your Copilot plan does not include Claude models, or (3) your organisation has disabled third-party extension access to the Language Model API.',
      );
    }
    this.cached = { model: any[0], family: any[0].family };
    return this.cached;
  }
}
