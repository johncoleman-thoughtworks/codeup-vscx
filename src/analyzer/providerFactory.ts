import * as vscode from 'vscode';
import { AnthropicClient } from './client';
import type { LLMClient, ProviderName } from './llm';
import { VSCodeLMClient } from './vscodeLMClient';

export type ProviderSetting = 'auto' | 'anthropic' | 'copilot';

export interface ResolvedProvider {
  client: LLMClient;
  /** The provider that was actually chosen. Useful for logging in auto mode
   *  so the user can see which path was selected. */
  resolved: ProviderName;
  /** Human-readable reason this provider was chosen. Surfaced in the output
   *  channel and the cost-prompt modal. */
  reason: string;
}

export class ProviderFactory {
  constructor(private readonly context: vscode.ExtensionContext) {}

  setting(): ProviderSetting {
    return vscode.workspace
      .getConfiguration('codeup')
      .get<ProviderSetting>('modelProvider', 'auto');
  }

  async resolve(): Promise<ResolvedProvider> {
    const setting = this.setting();
    const anthropic = new AnthropicClient(this.context);
    const copilot = new VSCodeLMClient();

    if (setting === 'anthropic') {
      return { client: anthropic, resolved: 'anthropic', reason: 'codeup.modelProvider = "anthropic"' };
    }
    if (setting === 'copilot') {
      const has = await copilot.hasCredentials();
      if (!has) {
        throw new Error(
          'codeup.modelProvider is set to "copilot" but no Copilot chat models are available. Sign in to GitHub Copilot (via the Copilot extension) or switch the setting to "auto" / "anthropic".',
        );
      }
      return { client: copilot, resolved: 'copilot', reason: 'codeup.modelProvider = "copilot"' };
    }

    // setting === 'auto': prefer Anthropic if a key is stored, else fall
    // back to Copilot. Surface the reason so the user can see which path
    // they ended up on.
    const anthropicReady = await anthropic.hasCredentials();
    if (anthropicReady) {
      return {
        client: anthropic,
        resolved: 'anthropic',
        reason: 'auto: Anthropic API key found in SecretStorage',
      };
    }
    const copilotReady = await copilot.hasCredentials();
    if (copilotReady) {
      return {
        client: copilot,
        resolved: 'copilot',
        reason: 'auto: no Anthropic key set, falling back to Copilot via vscode.lm',
      };
    }

    throw new Error(
      'No model provider is available. Either (a) set an Anthropic API key via "Codeup: Set Anthropic API Key", or (b) sign in to GitHub Copilot to use it via the Language Model API. Set codeup.modelProvider explicitly if you want a specific provider.',
    );
  }
}
