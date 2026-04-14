import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  plistPath as getPlistPath,
  IS_LINUX,
  LABEL,
  readDaemonConfig,
} from "./daemon-common";
import { daemonStatusLinux } from "./daemon-linux";

/** Parse the output of `launchctl list <label>` into a key-value map. */
function parseLaunchctlList(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*"([^"]+)"\s*=\s*(.+);$/);
    if (match?.[1] && match[2]) {
      const key = match[1];
      // Strip surrounding quotes from string values
      const raw = match[2].trim();
      result[key] =
        raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }
  return result;
}

/** Get the elapsed time since a process started, formatted as human-readable. */
function getUptime(pid: string): string | null {
  try {
    const lstart = execSync(`ps -o lstart= -p ${pid}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!lstart) return null;

    const startTime = new Date(lstart);
    const elapsedMs = Date.now() - startTime.getTime();
    if (elapsedMs < 0) return null;

    return formatSeconds(Math.floor(elapsedMs / 1000));
  } catch {
    return null;
  }
}

/** Format a duration in seconds into a human-readable string. */
function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

/** Read the last N lines of a file using tail. */
function tailFile(path: string, lines: number): string | null {
  if (!existsSync(path)) return null;
  try {
    return execSync(`tail -n ${lines} "${path}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trimEnd();
  } catch {
    return null;
  }
}

/** Fetch runtime info from the daemon's /health endpoint. */
async function fetchHealth(port: number): Promise<{
  version: string;
  uptime: number;
  projects: { total: number; idle: number; busy: number };
  sessions: number;
  memory: { rss: number };
} | null> {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function daemonStatus(): Promise<void> {
  if (IS_LINUX) return daemonStatusLinux();

  const home = homedir();
  const plist = getPlistPath();
  const logDir = join(home, ".flux/logs");
  const { fluxPort: port } = readDaemonConfig();

  // Check if plist exists
  const installed = existsSync(plist);

  // Check if loaded in launchd (need the full output for status parsing)
  let loaded = false;
  let info: Record<string, string> = {};
  try {
    const output = execSync(`launchctl list ${LABEL}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    loaded = true;
    info = parseLaunchctlList(output);
  } catch {
    // Not loaded
  }

  // Header
  console.log(`Daemon: ${LABEL}`);
  console.log(`Plist:  ${installed ? plist : "not installed"}`);
  console.log(`Loaded: ${loaded ? "yes" : "no"}`);

  if (!loaded) {
    if (!installed) {
      console.log(`\nThe daemon is not installed. Run: flux daemon install`);
    } else {
      console.log(
        `\nThe plist exists but the daemon is not loaded in launchd.`,
      );
      console.log(`Load it with: launchctl load "${plist}"`);
    }
    return;
  }

  // PID and uptime
  const pid = info.PID;
  if (pid) {
    const uptime = getUptime(pid);
    console.log(`PID:    ${pid}${uptime ? ` (up ${uptime})` : ""}`);
  } else {
    const exitStatus = info.LastExitStatus;
    console.log(
      `PID:    not running${exitStatus ? ` (last exit status: ${exitStatus})` : ""}`,
    );
  }

  // Runtime health info from /health endpoint
  if (pid) {
    const health = await fetchHealth(port);
    if (health) {
      console.log(`\n--- Runtime ---`);
      console.log(`Version:  ${health.version}`);
      console.log(`Uptime:   ${formatSeconds(health.uptime)}`);
      console.log(
        `Projects: ${health.projects.total} total (${health.projects.busy} busy, ${health.projects.idle} idle)`,
      );
      console.log(`Sessions: ${health.sessions} active`);
      console.log(`Memory:   ${health.memory.rss} MB RSS`);
    } else {
      console.log(`\n--- Runtime ---`);
      console.log(`Health:   unreachable (http://localhost:${port}/health)`);
      console.log(`          The process may still be starting up.`);
    }
  }

  // Recent logs
  const stdoutPath = join(logDir, "daemon.stdout.log");
  const stderrPath = join(logDir, "daemon.stderr.log");
  const LOG_LINES = 10;

  const stdoutTail = tailFile(stdoutPath, LOG_LINES);
  const stderrTail = tailFile(stderrPath, LOG_LINES);

  if (stdoutTail || stderrTail) {
    console.log(`\n--- Recent logs (last ${LOG_LINES} lines) ---`);
    if (stdoutTail) {
      console.log(`\n[stdout] ${stdoutPath}`);
      console.log(stdoutTail);
    }
    if (stderrTail) {
      console.log(`\n[stderr] ${stderrPath}`);
      console.log(stderrTail);
    }
  }
}
