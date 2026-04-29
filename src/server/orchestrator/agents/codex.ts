import {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  AgentOutputEvent,
  AgentProcess,
  AgentProvider,
  PlannerPromptContext,
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
  return env;
}

export class CodexProvider implements AgentProvider {
  name = "codex" as const;

  spawn(opts: SpawnOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "codex",
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
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

  resume(opts: ResumeOptions): AgentProcess {
    const proc = Bun.spawn(
      [
        "codex",
        "exec",
        "resume",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
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

  buildPlannerPrompt(_ctx: PlannerPromptContext): string {
    throw new Error("Planner is not supported by the Codex provider");
  }

  parseOutputLine(line: string): AgentOutputEvent[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
        return [{ type: "session_id", sessionId: obj.thread_id }];
      }
    } catch {
      // Codex emits JSONL here; ignore malformed lines defensively.
    }
    return [];
  }
}

function wrapProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
  return {
    pid: proc.pid,
    stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
    stdin: null,
    httpNudge: null,
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };
}
