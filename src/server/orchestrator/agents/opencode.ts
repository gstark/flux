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
  // OpenCode controls approvals/sandboxing through config permissions rather
  // than a single CLI bypass flag. We set an explicit permissive runtime config
  // instead of relying on tool-default behavior.
  // NOTE: OPENCODE_CONFIG_CONTENT is merged on top of the project's opencode.json,
  // so MCP servers defined there are preserved.
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    permission: "allow",
  });
  return env;
}

/** Pick a random port in the ephemeral range unlikely to conflict. */
function randomPort(): number {
  return 40000 + Math.floor(Math.random() * 10000);
}

export class OpenCodeProvider implements AgentProvider {
  name = "opencode" as const;

  spawn(opts: SpawnOptions): AgentProcess {
    const port = randomPort();
    const proc = Bun.spawn(
      [
        "opencode",
        "run",
        "--format",
        "json",
        "--port",
        String(port),
        "--dir",
        opts.cwd,
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName, opts.fluxIssueId),
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    return wrapProcess(proc, port);
  }

  resume(opts: ResumeOptions): AgentProcess {
    const port = randomPort();
    const proc = Bun.spawn(
      [
        "opencode",
        "run",
        "--format",
        "json",
        "--port",
        String(port),
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
    return wrapProcess(proc, port);
  }

  buildWorkPrompt(ctx: WorkPromptContext): string {
    return buildWorkPrompt(ctx, "opencode");
  }

  buildRetroPrompt(ctx: RetroPromptContext): string {
    return buildRetroPrompt(ctx, "opencode");
  }

  buildReviewPrompt(ctx: ReviewPromptContext): string {
    return buildReviewPrompt(ctx, "opencode");
  }

  buildPlannerPrompt(_ctx: PlannerPromptContext): string {
    throw new Error("Planner is not supported by the OpenCode provider");
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

function wrapProcess(
  proc: ReturnType<typeof Bun.spawn>,
  port: number,
): AgentProcess {
  return {
    pid: proc.pid,
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stdin: null,
    httpNudge: async (sessionId: string, message: string): Promise<void> => {
      const url = `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: message }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status !== 204) {
        const body = await resp.text().catch(() => "(no body)");
        throw new Error(
          `OpenCode prompt_async failed: HTTP ${resp.status} — ${body}`,
        );
      }
    },
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };
}
