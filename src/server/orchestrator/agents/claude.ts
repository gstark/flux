import {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  AgentOutputEvent,
  AgentProcess,
  AgentProvider,
  AgentStdin,
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
        "--input-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "-p",
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "ignore",
      },
    );

    const wrapped = wrapProcess(proc);
    sendInitialPrompt(wrapped, opts.prompt);
    return wrapped;
  }

  resume(opts: ResumeOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "claude",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--resume",
        opts.sessionId,
        "-p",
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "ignore",
      },
    );

    const wrapped = wrapProcess(proc);
    sendInitialPrompt(wrapped, opts.prompt);
    return wrapped;
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

  parseOutputLine(line: string): AgentOutputEvent[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === "system" && typeof obj.session_id === "string") {
        return [{ type: "session_id", sessionId: obj.session_id }];
      }
      if (obj.type === "result") {
        return [{ type: "result" }];
      }
    } catch {
      // Provider output is not guaranteed to be JSON on every line.
    }
    return [];
  }
}

/**
 * Deliver the initial prompt via stdin as a stream-json user message.
 *
 * When --input-format stream-json is set, Claude Code ignores the --print
 * positional prompt and reads from stdin instead. We write the prompt
 * immediately after spawn — the pipe is available synchronously.
 */
function sendInitialPrompt(agent: AgentProcess, prompt: string): void {
  if (!agent.stdin) {
    throw new Error("Cannot send initial prompt: agent stdin is null");
  }
  const payload = JSON.stringify({
    type: "user",
    message: { role: "user", content: prompt },
  });
  agent.stdin.write(`${payload}\n`);
  agent.stdin.flush();
}

function wrapProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
  const rawStdin = proc.stdin as
    | (AgentStdin & { end?: () => void })
    | undefined;
  const stdin: AgentStdin | null = rawStdin
    ? {
        write: (chunk) => rawStdin.write(chunk),
        flush: () => rawStdin.flush(),
        end: () => rawStdin.end?.(),
      }
    : null;

  return {
    pid: proc.pid,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stdin,
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };
}
