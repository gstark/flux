/**
 * Concurrent orchestrator integration test.
 *
 * Verifies that two ProjectRunners operating on separate projects can
 * claim and run sessions concurrently without interference:
 * - Sessions are scoped to the correct project
 * - Git commits land in the correct project repo
 * - Issue status updates target the correct project's issues
 * - No cross-contamination of state between runners
 *
 * Uses a MockAgentProvider that simulates agent work:
 * - Writes a marker file to the project repo
 * - Commits the change with a project-specific message
 * - Outputs a "done" disposition on stdout (work) or "noop" (review)
 * - Exits cleanly
 *
 * Requires: CONVEX_URL env var pointing to a running Convex deployment.
 * Runs against real Convex backend — creates and cleans up test data.
 *
 * Projects are created with `enabled: false` so the live daemon's
 * Orchestrator ignores them. Only the test's ProjectRunner instances
 * interact with these projects.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConvexClient } from "convex/browser";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { IssueStatus, SessionStatus } from "$convex/schema";
import type {
  AgentProcess,
  AgentProvider,
  ResumeOptions,
  RetroPromptContext,
  ReviewPromptContext,
  SpawnOptions,
  WorkPromptContext,
} from "./agents/types";
import { ProjectRunner } from "./index";

// ── Timeout for the full suite ──────────────────────────────────────
// Convex mutations + agent lifecycle can take time.
const TEST_TIMEOUT_MS = 120_000;

// ── Mock Agent Provider ──────────────────────────────────────────────
//
// Simulates a Claude Code agent that:
// 1. Writes a marker file into the project repo
// 2. Commits the change
// 3. Outputs a "done" disposition via stdout (for work sessions)
//    or "noop" (for review sessions, to break the review loop)
// 4. Exits with code 0
//
// Each call gets a unique marker so we can verify which project's repo
// received the commit. The label lets us identify which project's
// provider was used.

class MockAgentProvider implements AgentProvider {
  name = "mock-agent";
  private callCount = 0;
  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  buildWorkPrompt(_ctx: WorkPromptContext): string {
    return "mock work prompt";
  }

  buildRetroPrompt(_ctx: RetroPromptContext): string {
    return "mock retro prompt";
  }

  buildReviewPrompt(_ctx: ReviewPromptContext): string {
    return "mock review prompt";
  }

  spawn(opts: SpawnOptions): AgentProcess {
    const marker = `${this.label}-${++this.callCount}-${Date.now()}`;
    const cwd = opts.cwd;

    // Detect if this is a review prompt. The review prompt is built by
    // buildReviewPrompt which we control — we use a distinctive prefix.
    const isReview = opts.prompt === "mock review prompt";

    // For work: write a file, commit, output "done"
    // For review: output "noop" (no changes needed — breaks the review loop)
    const script = isReview
      ? `echo '{"disposition": "noop", "note": "review passed clean (${marker})"}'`
      : `set -e
echo "${marker}" > "${cwd}/agent-output-${marker}.txt"
git -C "${cwd}" add -A
git -C "${cwd}" commit -m "agent: ${marker}"
echo '{"disposition": "done", "note": "mock agent completed (${marker})"}'`;

    const proc = Bun.spawn(["bash", "-c", script], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    return wrapBunProcess(proc);
  }

  resume(opts: ResumeOptions): AgentProcess {
    // Retro phase — output noop (no action needed)
    const marker = `${this.label}-retro-${++this.callCount}-${Date.now()}`;
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `echo '{"disposition": "noop", "note": "retro complete (${marker})"}'`,
      ],
      {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return wrapBunProcess(proc);
  }
}

function wrapBunProcess(proc: ReturnType<typeof Bun.spawn>): AgentProcess {
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

// ── Test helpers ─────────────────────────────────────────────────────

/** Create a temporary git repository and return its path. */
async function createTempGitRepo(label: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `flux-test-${label}-`),
  );
  const run = (cmd: string) =>
    Bun.spawn(["bash", "-c", cmd], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
  await run("git init");
  await run('git config user.email "test@flux.dev"');
  await run('git config user.name "Flux Test"');
  await run("echo init > README.md && git add -A && git commit -m 'init'");
  return tmpDir;
}

/** Remove a temp directory. */
async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

/** Poll until a condition is true or timeout is reached. */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Get git log --oneline for a repo. */
async function getGitLog(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, "log", "--oneline"], {
    stdout: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

// ── Test suite ───────────────────────────────────────────────────────

describe("Concurrent orchestrator integration", () => {
  let convex: ConvexClient;
  let tmpDirA: string;
  let tmpDirB: string;
  let projectIdA: Id<"projects">;
  let projectIdB: Id<"projects">;
  const slugA = `test-concurrent-a-${Date.now()}`;
  const slugB = `test-concurrent-b-${Date.now()}`;

  beforeAll(async () => {
    const url = process.env.CONVEX_URL;
    if (!url)
      throw new Error("CONVEX_URL must be set to run integration tests");
    convex = new ConvexClient(url);

    // Create temp git repos
    [tmpDirA, tmpDirB] = await Promise.all([
      createTempGitRepo("proj-a"),
      createTempGitRepo("proj-b"),
    ]);

    // Create projects in Convex with enabled=false so the live daemon ignores them.
    // The test's ProjectRunner instances operate directly, bypassing the Orchestrator's
    // project subscription.
    projectIdA = await convex.mutation(api.projects.create, {
      slug: slugA,
      name: "Test Concurrent A",
      path: tmpDirA,
    });
    // projects.create defaults enabled=true, so disable immediately
    await convex.mutation(api.projects.update, {
      projectId: projectIdA,
      enabled: false,
    });

    projectIdB = await convex.mutation(api.projects.create, {
      slug: slugB,
      name: "Test Concurrent B",
      path: tmpDirB,
    });
    await convex.mutation(api.projects.update, {
      projectId: projectIdB,
      enabled: false,
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    // Clean up: remove projects (cascade deletes issues, sessions, etc.)
    try {
      await Promise.all([
        convex.mutation(api.projects.remove, { projectId: projectIdA }),
        convex.mutation(api.projects.remove, { projectId: projectIdB }),
      ]);
    } catch {
      // Best effort — projects may already be gone
    }

    // Clean up temp directories
    await Promise.all([removeTempDir(tmpDirA), removeTempDir(tmpDirB)]);

    // Close the client
    await convex.close();
  }, TEST_TIMEOUT_MS);

  test(
    "two runners process issues concurrently without interference",
    async () => {
      // Create one issue per project
      const [issueIdA, issueIdB] = await Promise.all([
        convex.mutation(api.issues.create, {
          projectId: projectIdA,
          title: "Test issue for project A",
        }),
        convex.mutation(api.issues.create, {
          projectId: projectIdB,
          title: "Test issue for project B",
        }),
      ]);

      // Create runners with mock providers. Each provider is labeled to
      // let us trace which project's agent committed which files.
      const providerA = new MockAgentProvider("projA");
      const providerB = new MockAgentProvider("projB");
      const runnerA = new ProjectRunner(projectIdA, tmpDirA, providerA);
      const runnerB = new ProjectRunner(projectIdB, tmpDirB, providerB);

      // Track session starts via lifecycle events
      const startTimesA: number[] = [];
      const startTimesB: number[] = [];
      runnerA.onLifecycle((event) => {
        if (event.type === "session_start") startTimesA.push(Date.now());
      });
      runnerB.onLifecycle((event) => {
        if (event.type === "session_start") startTimesB.push(Date.now());
      });

      // Subscribe both runners concurrently.
      // subscribe() creates orchestrator config, recovers orphans, and starts
      // watching ready issues — both will detect their issue and start processing.
      await Promise.all([runnerA.subscribe(), runnerB.subscribe()]);

      // Wait for both issues to reach a terminal state.
      await waitFor(async () => {
        const [issueA, issueB] = await Promise.all([
          convex.query(api.issues.get, { issueId: issueIdA }),
          convex.query(api.issues.get, { issueId: issueIdB }),
        ]);
        const aDone =
          issueA?.status === IssueStatus.Closed ||
          issueA?.status === IssueStatus.Stuck;
        const bDone =
          issueB?.status === IssueStatus.Closed ||
          issueB?.status === IssueStatus.Stuck;
        return aDone && bDone;
      }, 45_000);

      // ── Verify: both sessions actually started ────────────────────

      expect(startTimesA.length).toBeGreaterThanOrEqual(1);
      expect(startTimesB.length).toBeGreaterThanOrEqual(1);

      // Sessions should have started within 5 seconds of each other
      const firstA = startTimesA[0] as number;
      const firstB = startTimesB[0] as number;
      expect(Math.abs(firstA - firstB)).toBeLessThan(5_000);

      // ── Verify: sessions exist and are scoped correctly ──────────

      const [sessionsA, sessionsB] = await Promise.all([
        convex.query(api.sessions.list, { projectId: projectIdA }),
        convex.query(api.sessions.list, { projectId: projectIdB }),
      ]);

      // Each project should have at least one session
      expect(sessionsA.length).toBeGreaterThanOrEqual(1);
      expect(sessionsB.length).toBeGreaterThanOrEqual(1);

      // All sessions for project A should reference issueA and projectA
      for (const s of sessionsA) {
        expect(s.projectId).toBe(projectIdA);
        expect(s.issueId).toBe(issueIdA);
      }
      // All sessions for project B should reference issueB and projectB
      for (const s of sessionsB) {
        expect(s.projectId).toBe(projectIdB);
        expect(s.issueId).toBe(issueIdB);
      }

      // No sessions should still be "running" — both should have completed
      const allRunningSessions = [...sessionsA, ...sessionsB].filter(
        (s) => s.status === SessionStatus.Running,
      );
      expect(allRunningSessions.length).toBe(0);

      // ── Verify: git commits are in the correct repos ──────────

      const [logA, logB] = await Promise.all([
        getGitLog(tmpDirA),
        getGitLog(tmpDirB),
      ]);

      // Each repo should have commits beyond the initial 'init'
      // (either the agent's commit or the auto-commit from the orchestrator)
      const logLinesA = logA.split("\n");
      const logLinesB = logB.split("\n");
      expect(logLinesA.length).toBeGreaterThan(1);
      expect(logLinesB.length).toBeGreaterThan(1);

      // Project A's commits should contain "projA" marker, not "projB"
      expect(logA).toContain("projA");
      expect(logA).not.toContain("projB");

      // Project B's commits should contain "projB" marker, not "projA"
      expect(logB).toContain("projB");
      expect(logB).not.toContain("projA");

      // Agent marker files should be in the correct repos, not the other
      const filesA = await fs.readdir(tmpDirA);
      const filesB = await fs.readdir(tmpDirB);
      const agentFilesA = filesA.filter((f) => f.startsWith("agent-output-"));
      const agentFilesB = filesB.filter((f) => f.startsWith("agent-output-"));
      expect(agentFilesA.length).toBeGreaterThanOrEqual(1);
      expect(agentFilesB.length).toBeGreaterThanOrEqual(1);

      // Marker files contain the provider label in their names
      expect(agentFilesA.some((f) => f.includes("projA"))).toBe(true);
      expect(agentFilesB.some((f) => f.includes("projB"))).toBe(true);

      // No cross-contamination: projA files not in repo B, projB files not in repo A
      expect(agentFilesA.some((f) => f.includes("projB"))).toBe(false);
      expect(agentFilesB.some((f) => f.includes("projA"))).toBe(false);

      // ── Verify: issue status updates target the correct project ──

      const [finalIssueA, finalIssueB] = await Promise.all([
        convex.query(api.issues.get, { issueId: issueIdA }),
        convex.query(api.issues.get, { issueId: issueIdB }),
      ]);

      // Both issues should have been processed (not still open)
      expect(finalIssueA?.status).not.toBe(IssueStatus.Open);
      expect(finalIssueB?.status).not.toBe(IssueStatus.Open);

      // Issues belong to their respective projects
      expect(finalIssueA?.projectId).toBe(projectIdA);
      expect(finalIssueB?.projectId).toBe(projectIdB);

      // ── Cleanup runners ──────────────────────────────────────────

      await Promise.all([runnerA.destroy(), runnerB.destroy()]);
    },
    TEST_TIMEOUT_MS,
  );
});
