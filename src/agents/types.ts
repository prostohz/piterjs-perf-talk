export interface AgentSettings {
  provider: string;
  model: string;
  reasoningEffort: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(argumentsValue: unknown): Promise<{ success: boolean; text: string }>;
}

export interface AgentRequest {
  cwd: string;
  outputDirectory: string;
  settings: AgentSettings;
  prompt: string;
  responseSchema: Record<string, unknown>;
  signal: AbortSignal;
  tools: AgentTool[];
}

export interface CodingAgent {
  version(): Promise<string>;
  run(request: AgentRequest): Promise<unknown>;
}
