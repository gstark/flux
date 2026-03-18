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
  DispositionResult,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SessionPhase,
  SpawnOptions,
  WorkPromptContext,
} from "./types";
import { Disposition, SessionPhase as Phase } from "./types";

// ── Phase-specific JSON Schemas ──────────────────────────────────────
//
// Passed to Claude Code via --json-schema. Claude injects a
// StructuredOutput tool whose parameter descriptions come from
// these schemas — the richer the descriptions, the less the prompt
// needs to explain.

function buildDispositionSchema(descriptions: {
  done: string;
  noop: string;
  fault: string;
  note: string;
}): string {
  return JSON.stringify({
    type: "object",
    properties: {
      disposition: {
        type: "string",
        enum: ["done", "noop", "fault"],
        description: [
          `"done": ${descriptions.done}`,
          `"noop": ${descriptions.noop}`,
          `"fault": ${descriptions.fault}`,
        ].join(". "),
      },
      note: {
        type: "string",
        description: descriptions.note,
      },
    },
    required: ["disposition", "note"],
    additionalProperties: false,
  });
}

const DISPOSITION_SCHEMAS: Record<SessionPhase, string> = {
  [Phase.Work]: buildDispositionSchema({
    done: "Task completed successfully — work was performed and committed",
    noop: "No work needed — already fixed, duplicate, or not applicable",
    fault:
      "Could NOT complete the task due to an operational problem (missing access, unclear requirements, tooling failure) — not a code quality judgment",
    note: "What you did (for done), why no work was needed (for noop), or what blocked you (for fault)",
  }),
  [Phase.Retro]: buildDispositionSchema({
    done: "Created follow-up issues from findings",
    noop: "Reflected and found nothing actionable",
    fault: "Could not complete the retro due to an operational problem",
    note: "Summary of findings or why the retro could not complete",
  }),
  [Phase.Review]: buildDispositionSchema({
    done: "Review completed — fixed things inline, created follow-up issues, or both",
    noop: "Review completed — code is clean, no issues found",
    fault:
      "Could NOT complete the review due to an operational problem (not a code quality judgment)",
    note: "Summary of review findings and actions taken, or what blocked you",
  }),
};

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
        "--json-schema",
        DISPOSITION_SCHEMAS[opts.phase],
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
        "--json-schema",
        DISPOSITION_SCHEMAS[opts.phase],
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
        return [
          { type: "result", structuredOutput: parseStructuredOutput(obj) },
        ];
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

const VALID_DISPOSITIONS = new Set<string>(Object.values(Disposition));

/**
 * Extract and validate structured_output from a result event.
 *
 * Claude Code's --json-schema flag puts the validated output in
 * `result.structured_output`. We validate the shape here defensively
 * since the outer JSON is untyped stream output.
 */
function parseStructuredOutput(
  resultEvent: Record<string, unknown>,
): DispositionResult | undefined {
  const raw = resultEvent.structured_output;
  if (!raw || typeof raw !== "object") return undefined;

  const output = raw as Record<string, unknown>;
  const disposition = output.disposition;
  const note = output.note;

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

  // Schema validation passed on Claude's side but our stricter check failed.
  // This shouldn't happen, but fail visibly rather than silently dropping.
  return {
    success: false,
    error: `Structured output had unexpected shape: ${JSON.stringify(raw)}`,
  };
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
