import {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  AgentProcess,
  AgentProvider,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SpawnOptions,
  WorkPromptContext,
} from "./types";

export class ClaudeCodeProvider implements AgentProvider {
  name = "claude" as const;

  spawn(opts: SpawnOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "claude",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--print",
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    return wrapProcess(proc);
  }

  resume(opts: ResumeOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "claude",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--resume",
        opts.sessionId,
        "--print",
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    return wrapProcess(proc);
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
}

function wrapProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
  return {
    pid: proc.pid,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };
}
