export { ClaudeCodeProvider } from "./claude";
export { CodexProvider } from "./codex";
export { OpenCodeProvider } from "./opencode";
export { PiProvider } from "./pi";
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

import { ClaudeCodeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { OpenCodeProvider } from "./opencode";
import { PiProvider } from "./pi";
import type { AgentKind, AgentProvider } from "./types";

export function createAgentProvider(agent: AgentKind): AgentProvider {
  switch (agent) {
    case "claude":
      return new ClaudeCodeProvider();
    case "codex":
      return new CodexProvider();
    case "opencode":
      return new OpenCodeProvider();
    case "pi":
      return new PiProvider();
    default: {
      const exhaustive: never = agent;
      throw new Error(`Unknown agent provider: ${String(exhaustive)}`);
    }
  }
}
