// Provider-agnostic LLM client interface. Lets the analyzer call any model
// backend (Anthropic direct, VS Code Copilot via vscode.lm, future Bedrock
// or GitHub Models) without coupling to a specific SDK.

import * as vscode from 'vscode';

export type ProviderName = 'anthropic' | 'copilot';

export interface ReportedToolCall {
  /** Tool name the model invoked. For Codeup, always "report_finding" for now. */
  name: string;
  /** Tool input as a JSON-typed object — validated downstream against the
   *  catalogue and the report_finding schema. */
  input: unknown;
}

export interface LLMAnalyzeRequest {
  systemPrompt: string;
  userPrompt: string;
  /** The tool the model is expected to call zero or more times. Carries
   *  name + JSON schema. Matches the Anthropic SDK's Tool shape; clients
   *  translate to their backend's native tool format. */
  tool: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  maxOutputTokens: number;
  token?: vscode.CancellationToken;
}

export interface LLMAnalyzeResponse {
  toolCalls: ReportedToolCall[];
}

export interface LLMClient {
  /** Send a single analysis request, return the tool calls the model emitted. */
  analyze(req: LLMAnalyzeRequest): Promise<LLMAnalyzeResponse>;
  /** Human-readable identifier of the active model — used in cache keys and
   *  surfaced in the output channel. */
  model(): string;
  /** Which provider this client is — for transparency in logs / UI. */
  provider(): ProviderName;
  /** Reset any cached auth/session state (used when API key is changed). */
  reset(): void;
}
