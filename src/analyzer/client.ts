import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { getApiKey } from '../util/apiKey';

export class AnthropicClient {
  private client: Anthropic | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async ensure(): Promise<Anthropic> {
    if (this.client) return this.client;
    const key = await getApiKey(this.context, { prompt: true });
    if (!key) throw new Error('Anthropic API key not set');
    this.client = new Anthropic({ apiKey: key });
    return this.client;
  }

  reset(): void {
    this.client = undefined;
  }

  model(): string {
    return vscode.workspace.getConfiguration('codeup').get<string>('model', 'claude-sonnet-4-6');
  }
}
