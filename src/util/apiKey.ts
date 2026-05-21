import * as vscode from 'vscode';

const KEY = 'codeup.anthropicApiKey';

export async function getApiKey(context: vscode.ExtensionContext, opts: { prompt?: boolean } = {}): Promise<string | undefined> {
  let key = await context.secrets.get(KEY);
  if (key) return key;
  if (!opts.prompt) return undefined;
  key = await vscode.window.showInputBox({
    title: 'Anthropic API key',
    prompt: 'Enter your Anthropic API key. Stored in VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key) await context.secrets.store(KEY, key);
  return key;
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(KEY);
}
