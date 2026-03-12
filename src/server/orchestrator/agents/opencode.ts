import {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  AgentOutputEvent,
  AgentProcess,
  AgentProvider,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SpawnOptions,
  WorkPromptContext,
} from "./types";

export class OpenCodeProvider implements AgentProvider {
  name = "opencode" as const;

  spawn(_opts: SpawnOptions): AgentProcess {
    throw new Error(
      "[OpenCodeProvider] OpenCode runner is not implemented yet. Configure this project back to Claude until the OpenCode process adapter lands.",
    );
  }

  resume(_opts: ResumeOptions): AgentProcess {
    throw new Error(
      "[OpenCodeProvider] OpenCode resume is not implemented yet. Configure this project back to Claude until the OpenCode process adapter lands.",
    );
  }

  buildWorkPrompt(ctx: WorkPromptContext): string {
    return buildWorkPrompt(ctx);
  }

  buildRetroPrompt(ctx: RetroPromptContext): string {
    return buildRetroPrompt(ctx);
  }

  buildReviewPrompt(ctx: ReviewPromptContext): string {
    return buildReviewPrompt(ctx);
  }

  parseOutputLine(_line: string): AgentOutputEvent[] {
    return [];
  }
}
