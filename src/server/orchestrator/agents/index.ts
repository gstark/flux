export { ClaudeCodeProvider } from "./claude";
export { CodexProvider } from "./codex";
export { OpenCodeProvider } from "./opencode";
export {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
  parseDisposition,
  StatusMessages,
} from "./prompts";
export type {
  AgentKind,
  AgentOutputEvent,
  AgentProcess,
  AgentProvider,
  DispositionResult,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SpawnOptions,
  WorkPromptContext,
} from "./types";
export { AgentKind as AgentKindValues, Disposition } from "./types";

import type { AgentKind, AgentProvider } from "./types";
import { ClaudeCodeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { OpenCodeProvider } from "./opencode";

export function createAgentProvider(agent: AgentKind): AgentProvider {
  switch (agent) {
    case "claude":
      return new ClaudeCodeProvider();
    case "codex":
      return new CodexProvider();
    case "opencode":
      return new OpenCodeProvider();
    default: {
      const exhaustive: never = agent;
      throw new Error(`Unknown agent provider: ${String(exhaustive)}`);
    }
  }
}
