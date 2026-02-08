import fs from "node:fs/promises";
import { $ } from "bun";
import type { SessionPhaseValue } from "$convex/schema";
import { isProcessAlive } from "./process";

export async function resolveRepoRoot(cwd?: string): Promise<string> {
  try {
    const result = cwd
      ? (await $`git -C ${cwd} rev-parse --show-toplevel`.text()).trim()
      : (await $`git rev-parse --show-toplevel`.text()).trim();
    if (!result) {
      throw new Error("Not a git repository");
    }
    return result;
  } catch {
    const location = cwd ? ` (cwd: ${cwd})` : "";
    throw new Error(
      `Error: Not in a git repository${location}. Flux requires git for project resolution and change tracking.`,
    );
  }
}

/** Result of validating a project path before registration. */
export type PathValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate that a path is suitable for project registration:
 * 1. Directory exists on the filesystem
 * 2. Directory is a git repository
 */
export async function validateProjectPath(
  path: string,
): Promise<PathValidationResult> {
  // Check the directory exists and is actually a directory
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(path);
  } catch {
    return { ok: false, error: `Directory does not exist: ${path}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `Path is not a directory: ${path}` };
  }

  // Check it's a git repository
  try {
    await $`git -C ${path} rev-parse --git-dir`.quiet();
  } catch {
    return {
      ok: false,
      error: `Directory is not a git repository: ${path}`,
    };
  }

  return { ok: true };
}

/**
 * Infer a project slug from a git repository.
 * Tries the git remote origin URL first, falls back to directory name.
 *
 * @param cwd — When provided, uses `git -C <cwd>` and falls back to
 *   the last segment of `cwd`. Without it, runs bare `git` from the
 *   process CWD and falls back via `resolveRepoRoot()`.
 */
export async function inferProjectSlug(cwd?: string): Promise<string> {
  try {
    const remote = cwd
      ? (await $`git -C ${cwd} remote get-url origin`.text()).trim()
      : (await $`git remote get-url origin`.text()).trim();
    // Parse various git remote formats:
    // - https://github.com/user/repo.git   → match after last /
    // - git@github.com:user/repo.git       → match after last /
    // - git@github.com:repo.git            → match after :
    const match = remote.match(/[/:]([\w.~-]+?)(?:\.git)?$/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fall through to directory name
  }

  // Fallback: use directory name
  if (cwd) {
    const segments = cwd.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] || "unknown";
  }
  const repoRoot = await resolveRepoRoot(cwd);
  return repoRoot.split("/").pop() || "unknown";
}

/**
 * Get the current HEAD commit SHA.
 * Throws if not in a git repo or HEAD is unborn (no commits yet).
 * @returns The 40-character hex SHA of the current HEAD commit.
 */
export async function getCurrentHead(cwd: string): Promise<string> {
  const result = (await $`git -C ${cwd} rev-parse HEAD`.text()).trim();
  if (!result) {
    throw new Error(
      "Failed to resolve git HEAD. Is this a git repository with at least one commit?",
    );
  }
  return result;
}

/**
 * Check if there are new commits since the given SHA.
 * Throws on git errors — callers must handle failures explicitly.
 */
export async function hasNewCommits(
  cwd: string,
  since: string,
): Promise<boolean> {
  const log = (
    await $`git -C ${cwd} log ${since}..HEAD --oneline`.text()
  ).trim();
  return log.length > 0;
}

/**
 * Get the diff between a starting commit and HEAD.
 * Throws on git errors — callers must handle failures explicitly.
 */
export async function getDiff(cwd: string, since: string): Promise<string> {
  return (await $`git -C ${cwd} diff ${since}..HEAD`.text()).trim();
}

/**
 * Get one-line commit log between a starting commit and HEAD.
 * Throws on git errors — callers must handle failures explicitly.
 */
export async function getCommitLog(
  cwd: string,
  since: string,
): Promise<string> {
  return (await $`git -C ${cwd} log ${since}..HEAD --oneline`.text()).trim();
}

/**
 * Auto-commit any dirty working tree changes.
 * Returns true if a commit was made, false if tree was clean or commit was suppressed.
 * Non-blocking by design — callers should catch errors and continue.
 *
 * When `agentPid` is provided, the commit is suppressed if that process is still
 * alive. This prevents the orchestrator from racing with a still-running agent
 * (e.g., PostToolUse hooks modifying files after the agent's last tool call).
 *
 * @example Commit message format:
 * ```
 * [FLUX-11] chore(flux): auto-commit uncommitted agent changes (review)
 *
 * Session: k57abc123def456
 * ```
 */
export async function autoCommitDirtyTree(
  cwd: string,
  shortId: string,
  sessionId: string,
  phase?: SessionPhaseValue,
  agentPid?: number,
): Promise<boolean> {
  // Guard: suppress auto-commit if the agent process is still alive.
  // This prevents racing with PostToolUse hooks or other agent child processes
  // that may still be modifying files.
  if (agentPid !== undefined && isProcessAlive(agentPid)) {
    console.warn(
      `[git] Suppressing auto-commit: agent PID ${agentPid} is still alive`,
    );
    return false;
  }

  const status = (await $`git -C ${cwd} status --porcelain`.text()).trim();
  if (!status) return false;

  await $`git -C ${cwd} add -A`;

  const phaseTag = phase ? ` (${phase})` : "";
  const message = `[${shortId}] chore(flux): auto-commit uncommitted agent changes${phaseTag}\n\nSession: ${sessionId}`;
  await $`git -C ${cwd} commit -m ${message}`;
  return true;
}
