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

/** Build a clean env for spawned agents, stripping Flux-specific vars
 *  so child processes don't inherit (and clobber) deployment config.
 *
 *  Background: The daemon runs with CONVEX_URL/CONVEX_DEPLOYMENT set
 *  for its own backend. Spawned agents should use their own Convex
 *  config (if any), not inherit ours. Prevents accidental cross-deployment
 *  mutations if an agent spawns Convex-aware subprocesses.
 */
function agentEnv(
  sessionId?: string,
  agentName?: string,
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CONVEX_URL;
  delete env.CONVEX_DEPLOYMENT;
  if (sessionId) env.FLUX_SESSION_ID = sessionId;
  if (agentName) env.FLUX_AGENT_NAME = agentName;
  return env;
}

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
        env: agentEnv(opts.fluxSessionId, opts.agentName),
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
        env: agentEnv(opts.fluxSessionId, opts.agentName),
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
