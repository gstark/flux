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

function describeUnknownAgent(agent: unknown): string {
  const value = String(agent);
  const codePoints = [...value]
    .map((char) => `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
  return `${JSON.stringify(value)} (type=${typeof agent}${codePoints ? `, codePoints=${codePoints}` : ""})`;
}

export function createAgentProvider(agent: AgentKind): AgentProvider {
  const kind = String(agent);

  switch (kind) {
    case "claude":
      return new ClaudeCodeProvider();
    case "codex":
      return new CodexProvider();
    case "opencode":
      return new OpenCodeProvider();
    case "pi":
      return new PiProvider();
    default:
      throw new Error(`Unknown agent provider: ${describeUnknownAgent(agent)}`);
  }
}
