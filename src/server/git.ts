import { $ } from "bun";

export async function resolveRepoRoot(): Promise<string> {
  try {
    const result = (await $`git rev-parse --show-toplevel`.text()).trim();
    if (!result) {
      throw new Error("Not a git repository");
    }
    return result;
  } catch {
    throw new Error(
      "Error: Not in a git repository. Flux requires git for project resolution and change tracking.",
    );
  }
}

export async function inferProjectSlug(): Promise<string> {
  try {
    const remote = (await $`git remote get-url origin`.text()).trim();
    // Parse various git remote formats:
    // - https://github.com/user/repo.git
    // - git@github.com:user/repo.git
    // - git@gitlab.com:user/repo
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fall through to directory name
  }

  // Fallback: use directory name
  const repoRoot = await resolveRepoRoot();
  return repoRoot.split("/").pop() || "flux";
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
 * Returns true if a commit was made, false if tree was clean.
 * Non-blocking by design — callers should catch errors and continue.
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
  phase?: string,
): Promise<boolean> {
  const status = (await $`git -C ${cwd} status --porcelain`.text()).trim();
  if (!status) return false;

  await $`git -C ${cwd} add -A`;

  const phaseTag = phase ? ` (${phase})` : "";
  const message = `[${shortId}] chore(flux): auto-commit uncommitted agent changes${phaseTag}\n\nSession: ${sessionId}`;
  await $`git -C ${cwd} commit -m ${message}`;
  return true;
}
