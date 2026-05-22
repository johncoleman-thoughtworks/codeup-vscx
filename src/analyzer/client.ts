import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { abortSignalFor } from '../util/abort';
import { getApiKey } from '../util/apiKey';
import type { LLMAnalyzeRequest, LLMAnalyzeResponse, LLMClient, ProviderName } from './llm';

export class AnthropicClient implements LLMClient {
  private client: Anthropic | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  provider(): ProviderName {
    return 'anthropic';
  }

  model(): string {
    return vscode.workspace.getConfiguration('codeup').get<string>('model', 'claude-sonnet-4-6');
  }

  reset(): void {
    this.client = undefined;
  }

  async analyze(req: LLMAnalyzeRequest): Promise<LLMAnalyzeResponse> {
    const client = await this.ensure();
    const abort = req.token ? abortSignalFor(req.token) : undefined;
    try {
      const response = await client.messages.create(
        {
          model: this.model(),
          max_tokens: req.maxOutputTokens,
          system: req.systemPrompt,
          tools: [
            {
              name: req.tool.name,
              description: req.tool.description,
              input_schema: req.tool.input_schema as Anthropic.Tool.InputSchema,
            },
          ],
          messages: [{ role: 'user', content: req.userPrompt }],
        },
        abort ? { signal: abort.signal } : undefined,
      );
      const toolCalls = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({ name: block.name, input: block.input }));
      return { toolCalls };
    } finally {
      abort?.dispose();
    }
  }

  /** Returns true if an Anthropic API key is stored. Used by the provider
   *  factory's "auto" mode to choose between Anthropic and Copilot without
   *  prompting the user. */
  async hasCredentials(): Promise<boolean> {
    const key = await getApiKey(this.context, { prompt: false });
    return Boolean(key);
  }

  private async ensure(): Promise<Anthropic> {
    if (this.client) return this.client;
    const key = await getApiKey(this.context, { prompt: true });
    if (!key) throw new Error('Anthropic API key not set');
    this.client = new Anthropic({ apiKey: key });
    return this.client;
  }
}
