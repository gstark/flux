import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildPlannerPrompt,
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  AgentOutputEvent,
  AgentProcess,
  AgentProvider,
  AgentStdin,
  DispositionResult,
  PlannerPromptContext,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SpawnOptions,
  WorkPromptContext,
} from "./types";
import { Disposition } from "./types";

const VALID_DISPOSITIONS = new Set<string>(Object.values(Disposition));
const FLUX_DISPOSITION_PREFIX = "FLUX_DISPOSITION ";
const PI_FLUX_DISPOSITION_TOOL = "flux_report_disposition";
const PI_DISPOSITION_EXTENSION_PATH = fileURLToPath(
  new URL("./pi-flux-disposition-extension.js", import.meta.url),
);

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

function managedSessionDir(fluxSessionId?: string): string {
  if (!fluxSessionId) {
    throw new Error(
      "Pi provider requires fluxSessionId so Flux can manage a deterministic pi session directory.",
    );
  }

  const dir = join("/tmp", "flux-pi-sessions", fluxSessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class PiProvider implements AgentProvider {
  name = "pi" as const;

  spawn(opts: SpawnOptions): AgentProcess {
    const sessionDir = managedSessionDir(opts.fluxSessionId);
    const proc = Bun.spawn(
      [
        "pi",
        "--mode",
        "rpc",
        "--session-dir",
        sessionDir,
        "--extension",
        PI_DISPOSITION_EXTENSION_PATH,
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName, opts.fluxIssueId),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "ignore",
      },
    );

    const wrapped = wrapProcess(proc);
    sendRpcPrompt(wrapped, opts.prompt);
    return wrapped;
  }

  resume(opts: ResumeOptions): AgentProcess {
    const sessionDir = managedSessionDir(opts.fluxSessionId ?? opts.sessionId);
    const proc = Bun.spawn(
      [
        "pi",
        "--mode",
        "rpc",
        "--session-dir",
        sessionDir,
        "-c",
        "--extension",
        PI_DISPOSITION_EXTENSION_PATH,
      ],
      {
        cwd: opts.cwd,
        env: agentEnv(opts.fluxSessionId, opts.agentName, opts.fluxIssueId),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "ignore",
      },
    );

    const wrapped = wrapProcess(proc);
    sendRpcPrompt(wrapped, opts.prompt);
    return wrapped;
  }

  buildWorkPrompt(ctx: WorkPromptContext): string {
    return addPiInstructions(buildWorkPrompt(ctx));
  }

  buildRetroPrompt(ctx: RetroPromptContext): string {
    return addPiInstructions(buildRetroPrompt(ctx));
  }

  buildReviewPrompt(ctx: ReviewPromptContext): string {
    return addPiInstructions(buildReviewPrompt(ctx));
  }

  buildPlannerPrompt(ctx: PlannerPromptContext): string {
    return addPiInstructions(buildPlannerPrompt(ctx));
  }

  parseOutputLine(line: string): AgentOutputEvent[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;

      if (obj.type === "session" && typeof obj.id === "string") {
        return [{ type: "session_id", sessionId: obj.id }];
      }

      if (obj.type === "tool_execution_end") {
        const structured = extractDispositionFromToolExecution(obj);
        if (structured) {
          return [{ type: "result", structuredOutput: structured }];
        }
      }

      if (obj.type === "message_end") {
        const structured = extractDispositionFromRpcMessage(obj.message);
        if (structured) {
          return [{ type: "result", structuredOutput: structured }];
        }
      }

      if (obj.type === "agent_end" && Array.isArray(obj.messages)) {
        const events: AgentOutputEvent[] = [];
        for (const message of obj.messages) {
          const structured = extractDispositionFromRpcMessage(message);
          if (structured) {
            events.push({ type: "result", structuredOutput: structured });
          }
        }
        return events;
      }
    } catch {
      // Pi RPC uses JSONL. Ignore malformed lines defensively.
    }

    return [];
  }
}

function addPiInstructions(prompt: string): string {
  return [
    prompt,
    "",
    "## Pi Provider Instructions",
    "- You are running under Pi RPC, not Claude Code.",
    "- Use local file tools directly for code changes.",
    "- Use shell commands for Flux operations via the `flux` CLI.",
    "- Prefer the `flux` CLI over inventing your own issue tracking workflow.",
    "",
    "### Flux CLI Usage",
    "Use commands like:",
    "- `flux issues list`",
    "- `flux issues search \"query\"`",
    "- `flux issues create --title \"...\" --description \"...\"`",
    "- `flux comments create ISSUE_ID --content \"...\"`",
    "- `flux deps add BLOCKER_ID BLOCKED_ID`",
    "- `flux epics list`",
    "",
    "Do NOT manually close or change the status of the assigned issue unless explicitly instructed. The Flux orchestrator manages lifecycle.",
    "",
    "## Required Completion Step",
    "When you are completely finished, call the `flux_report_disposition` tool exactly once.",
    "Use it only for the final outcome of the session.",
    "",
    "Allowed dispositions:",
    "- `done` = task completed successfully",
    "- `noop` = no work was needed",
    "- `fault` = you could not complete due to an operational problem",
    "",
    "Compatibility note: if the tool is unavailable for some reason, end with this exact fallback marker:",
    'FLUX_DISPOSITION {"disposition":"done","note":"what you accomplished"}',
  ].join("\n");
}

function sendRpcPrompt(agent: AgentProcess, prompt: string): void {
  if (!agent.stdin) {
    throw new Error("Cannot send prompt to pi RPC: agent stdin is null");
  }

  const payload = JSON.stringify({
    id: "flux-initial-prompt",
    type: "prompt",
    message: prompt,
  });

  agent.stdin.write(`${payload}\n`);
  agent.stdin.flush();
}

function extractDispositionFromToolExecution(
  rawEvent: Record<string, unknown>,
): DispositionResult | undefined {
  if (rawEvent.toolName !== PI_FLUX_DISPOSITION_TOOL) return undefined;

  const result = rawEvent.result;
  if (!result || typeof result !== "object") {
    return {
      success: false,
      error: "Pi flux_report_disposition result was missing result payload",
    };
  }

  const details = (result as Record<string, unknown>).details;
  if (!details || typeof details !== "object") {
    return {
      success: false,
      error: "Pi flux_report_disposition result was missing details payload",
    };
  }

  return parseDispositionObject(
    details as Record<string, unknown>,
    "Pi flux_report_disposition",
  );
}

function extractDispositionFromRpcMessage(
  rawMessage: unknown,
): DispositionResult | undefined {
  if (!rawMessage || typeof rawMessage !== "object") return undefined;

  const message = rawMessage as Record<string, unknown>;
  if (message.role !== "assistant") return undefined;

  const content = extractAssistantText(message.content);
  if (!content) return undefined;

  return parseDispositionMarker(content);
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const obj = block as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      parts.push(obj.text);
    }
  }

  return parts.join("\n");
}

function parseDispositionMarker(text: string): DispositionResult | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.startsWith(FLUX_DISPOSITION_PREFIX)) continue;

    const payload = line.slice(FLUX_DISPOSITION_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return parseDispositionObject(parsed, `Pi FLUX_DISPOSITION ${payload}`);
    } catch (error) {
      return {
        success: false,
        error: `Pi FLUX_DISPOSITION was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return undefined;
}

function parseDispositionObject(
  parsed: Record<string, unknown>,
  source: string,
): DispositionResult {
  const disposition = parsed.disposition;
  const note = parsed.note;

  if (
    typeof disposition === "string" &&
    VALID_DISPOSITIONS.has(disposition) &&
    typeof note === "string"
  ) {
    return {
      success: true,
      disposition: disposition as Disposition,
      note,
    };
  }

  return {
    success: false,
    error: `${source} had unexpected shape: ${JSON.stringify(parsed)}`,
  };
}

function sendRpcSteer(agent: AgentProcess, message: string): Promise<void> {
  if (!agent.stdin) {
    return Promise.reject(
      new Error("Cannot send steer command to pi RPC: agent stdin is null"),
    );
  }

  const payload = JSON.stringify({
    type: "steer",
    message,
  });

  return Promise.resolve(agent.stdin.write(`${payload}\n`)).then(async () => {
    await agent.stdin?.flush();
  });
}

function wrapProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
  const rawStdin = proc.stdin as unknown as
    | (AgentStdin & { end?: () => void })
    | undefined;
  const stdin: AgentStdin | null = rawStdin
    ? {
        write: (chunk) => rawStdin.write(chunk),
        flush: () => rawStdin.flush(),
        end: () => rawStdin.end?.(),
      }
    : null;

  const agent: AgentProcess = {
    pid: proc.pid,
    stdout: proc.stdout as unknown as ReadableStream<Uint8Array>,
    stdin,
    httpNudge: null,
    kill: () => proc.kill(),
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
  };

  agent.httpNudge = async (_sessionId: string, message: string) => {
    await sendRpcSteer(agent, message);
  };

  return agent;
}
