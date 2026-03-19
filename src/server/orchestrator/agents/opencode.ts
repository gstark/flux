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

function agentEnv(
  sessionId?: string,
  agentName?: string,
  issueId?: string,
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CONVEX_URL;
  delete env.CONVEX_DEPLOYMENT;
  if (sessionId) env.FLUX_SESSION_ID = sessionId;
  if (agentName) env.FLUX_AGENT_NAME = agentName;
  if (issueId) env.FLUX_ISSUE_ID = issueId;
  // OpenCode controls approvals/sandboxing through config permissions rather
  // than a single CLI bypass flag. We set an explicit permissive runtime config
  // instead of relying on tool-default behavior.
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    permission: "allow",
  });
  return env;
}

export class OpenCodeProvider implements AgentProvider {
  name = "opencode" as const;

  spawn(opts: SpawnOptions): AgentProcess {
    const proc = Bun.spawn(
      ["opencode", "run", "--format", "json", "--dir", opts.cwd, opts.prompt],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName, opts.fluxIssueId),
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    return wrapProcess(proc);
  }

  resume(opts: ResumeOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "opencode",
        "run",
        "--format",
        "json",
        "--dir",
        opts.cwd,
        "--session",
        opts.sessionId,
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName, opts.fluxIssueId),
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

  parseOutputLine(line: string): AgentOutputEvent[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.sessionID === "string") {
        return [{ type: "session_id", sessionId: obj.sessionID }];
      }
    } catch {
      // OpenCode emits JSONL here; ignore malformed lines defensively.
    }
    return [];
  }
}

function wrapProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
  return {
    pid: proc.pid,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stdin: null,
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };
}
