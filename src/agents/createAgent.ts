import { CodexAgent } from "./codex/index.js";
import type { CodingAgent, AgentSettings } from "./types.js";

export function createAgent(settings: AgentSettings): CodingAgent {
  switch (settings.provider) {
    case "codex":
      return new CodexAgent();
    default:
      throw new Error(`Unsupported agent provider: ${settings.provider}`);
  }
}
