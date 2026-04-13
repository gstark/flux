import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type DaemonInstallOpts,
  type DaemonMode,
  isDaemonActiveLinux,
  isServiceInstalledLinux,
  LABEL,
  readDaemonConfig,
  resolvePorts,
  servicePath,
  writeDaemonConfig,
} from "./daemon-common";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read CONVEX_URL from env, falling back to .env.local. */
function resolveConvexUrl(): string {
  let convexUrl = process.env.CONVEX_URL;

  if (!convexUrl) {
    const envPath = join(projectRoot(), ".env.local");
    if (existsSync(envPath)) {
      const contents = readFileSync(envPath, "utf-8");
      for (const line of contents.split("\n")) {
        const match = line.match(/^(?:VITE_)?CONVEX_URL\s*=\s*(.+)/);
        const raw = match?.[1]?.trim();
        if (raw) {
          const isQuoted = /^(['"]).*\1$/.test(raw);
          convexUrl = isQuoted
            ? raw.replace(/^(['"])(.*)\1$/, "$2")
            : raw.replace(/\s+#.*$/, "");
          break;
        }
      }
    }
  }

  if (!convexUrl) {
    throw new Error(
      "CONVEX_URL is not set. Set it in your environment or in .env.local",
    );
  }

  return convexUrl;
}

/** Resolve the Flux project root (two levels up from src/cli/). */
function projectRoot(): string {
  return resolve(import.meta.dir, "../..");
}

/** Find the absolute path to the system bun binary (not node_modules shims). */
function resolveBunPath(): string {
  try {
    const all = execSync("which -a bun", { encoding: "utf-8" })
      .trim()
      .split("\n");
    const systemBun = all.find((p) => !p.includes("node_modules"));
    if (systemBun) return systemBun;
    if (all[0]) return all[0];
    throw new Error("no output");
  } catch {
    throw new Error(
      "Could not find bun binary. Ensure bun is installed and on your PATH.",
    );
  }
}

/** Generate a systemd user service file. */
function generateServiceFile(opts: {
  bunPath: string;
  workingDirectory: string;
  logDir: string;
  mode: DaemonMode;
  envVars: {
    CONVEX_URL: string;
    FLUX_PORT: string;
    FLUX_VITE_PORT: string;
  };
}): string {
  // Prepend the directory containing bun to PATH so that concurrently's
  // subprocesses (bun --watch, bunx vite, convex) can all find it.
  const bunDir = dirname(opts.bunPath);
  const existingPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const path = `${bunDir}:${existingPath}`;
  const execCommand =
    opts.mode === "prod"
      ? `${opts.bunPath} run start`
      : `${opts.bunPath} run dev`;

  return `[Unit]
Description=Flux daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=${opts.workingDirectory}
ExecStart=${execCommand}
Environment=PATH=${path}
Environment=CONVEX_URL=${opts.envVars.CONVEX_URL}
Environment=FLUX_PORT=${opts.envVars.FLUX_PORT}
Environment=FLUX_VITE_PORT=${opts.envVars.FLUX_VITE_PORT}
Restart=always
RestartSec=3
StandardOutput=append:${opts.logDir}/daemon.stdout.log
StandardError=append:${opts.logDir}/daemon.stderr.log

[Install]
WantedBy=default.target
`;
}

// ---------------------------------------------------------------------------
// Exported commands
// ---------------------------------------------------------------------------

export async function daemonInstallLinux(
  opts: DaemonInstallOpts = {},
): Promise<void> {
  const root = projectRoot();
  const home = homedir();
  const service = servicePath();
  const serviceDir = dirname(service);
  const logDir = join(home, ".flux/logs");

  const bunPath = resolveBunPath();
  const convexUrl = resolveConvexUrl();
  const { fluxPort, fluxVitePort } = resolvePorts(opts);
  const mode: DaemonMode = opts.mode ?? "dev";
  const envVars = {
    CONVEX_URL: convexUrl,
    FLUX_PORT: String(fluxPort),
    FLUX_VITE_PORT: String(fluxVitePort),
  };

  console.log(`Mode:            ${mode}`);
  console.log(`Bun:             ${bunPath}`);
  console.log(`CONVEX_URL:      ${envVars.CONVEX_URL}`);
  console.log(`FLUX_PORT:       ${envVars.FLUX_PORT}`);
  if (mode === "dev") {
    console.log(`FLUX_VITE_PORT:  ${envVars.FLUX_VITE_PORT}`);
  }

  if (mode === "prod") {
    const distIndex = join(root, "dist/index.html");
    if (!existsSync(distIndex)) {
      throw new Error(
        `Prod mode requires a built frontend at ${distIndex}. ` +
          `Run: bun run build`,
      );
    }
  }

  // Ensure directories exist
  mkdirSync(logDir, { recursive: true });
  mkdirSync(serviceDir, { recursive: true });

  // Stop + disable if already installed (idempotent reinstall)
  if (isServiceInstalledLinux()) {
    console.log(`Stopping existing ${LABEL}...`);
    try {
      execSync(`systemctl --user stop ${LABEL}`, { stdio: "pipe" });
      execSync(`systemctl --user disable ${LABEL}`, { stdio: "pipe" });
    } catch {
      // Ignore — may not have been active
    }
  }

  // Write the service file
  const serviceContent = generateServiceFile({
    bunPath,
    workingDirectory: root,
    logDir,
    mode,
    envVars,
  });
  writeFileSync(service, serviceContent);
  console.log(`Wrote ${service}`);

  // Persist port choice so status/start commands resolve the right URL
  writeDaemonConfig({ fluxPort, fluxVitePort });

  // Reload systemd, enable and start
  execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  execSync(`systemctl --user enable ${LABEL}`, { stdio: "pipe" });
  execSync(`systemctl --user start ${LABEL}`, { stdio: "pipe" });

  if (!isDaemonActiveLinux()) {
    throw new Error(
      `Failed to start ${LABEL}. Check logs: journalctl --user -u ${LABEL} -n 50`,
    );
  }

  console.log(`\n✓ ${LABEL} is running via systemd`);
  console.log(
    `\nLogs:\n  stdout: ${logDir}/daemon.stdout.log\n  stderr: ${logDir}/daemon.stderr.log`,
  );
  console.log(`  Live:   journalctl --user -u ${LABEL} -f`);
  console.log(`\nVerify: curl http://localhost:${envVars.FLUX_PORT}/health`);
}

export async function daemonUninstallLinux(): Promise<void> {
  const service = servicePath();

  if (!isServiceInstalledLinux()) {
    console.log(
      `${LABEL} is not installed (${service} does not exist). Nothing to do.`,
    );
    return;
  }

  // Stop and disable
  if (isDaemonActiveLinux()) {
    console.log(`Stopping ${LABEL}...`);
    execSync(`systemctl --user stop ${LABEL}`, { stdio: "pipe" });
  }

  try {
    execSync(`systemctl --user disable ${LABEL}`, { stdio: "pipe" });
  } catch {
    // May already be disabled
  }

  // Remove service file and reload
  unlinkSync(service);
  console.log(`Removed ${service}`);
  execSync("systemctl --user daemon-reload", { stdio: "pipe" });

  if (isDaemonActiveLinux()) {
    throw new Error(
      `${LABEL} is still active after uninstall. Manual intervention may be needed.`,
    );
  }

  console.log(`\n✓ ${LABEL} has been uninstalled`);
  console.log(
    `\nNote: Log files at ~/.flux/logs/ have been preserved. Remove them manually if desired.`,
  );
}

export async function daemonStartLinux(): Promise<void> {
  if (!isServiceInstalledLinux()) {
    console.error(`${LABEL} is not installed. Run: flux daemon install`);
    process.exit(1);
  }

  console.log(`Starting ${LABEL}...`);
  execSync(`systemctl --user start ${LABEL}`, { stdio: "pipe" });
  console.log(`Started ${LABEL}.`);

  const { fluxPort } = readDaemonConfig();
  console.log(`\nVerify: curl http://localhost:${fluxPort}/health`);
  console.log(`Or run: flux daemon status`);
}

export async function daemonStopLinux(): Promise<void> {
  if (!isServiceInstalledLinux()) {
    console.error(`${LABEL} is not installed. Run: flux daemon install`);
    process.exit(1);
  }

  if (!isDaemonActiveLinux()) {
    console.error(`${LABEL} is not running. Nothing to stop.`);
    process.exit(1);
  }

  console.log(`Stopping ${LABEL}...`);
  execSync(`systemctl --user stop ${LABEL}`, { stdio: "pipe" });
  console.log(`Stopped ${LABEL}. Run 'flux daemon start' to start it again.`);
}

export async function daemonStatusLinux(): Promise<void> {
  const service = servicePath();
  const home = homedir();
  const logDir = join(home, ".flux/logs");
  const { fluxPort: port } = readDaemonConfig();

  const installed = isServiceInstalledLinux();
  const active = isDaemonActiveLinux();

  console.log(`Daemon: ${LABEL}`);
  console.log(`Service: ${installed ? service : "not installed"}`);
  console.log(`Active: ${active ? "yes" : "no"}`);

  if (!installed) {
    console.log(`\nThe daemon is not installed. Run: flux daemon install`);
    return;
  }

  if (!active) {
    console.log(`\nThe service is installed but not running.`);
    console.log(`Start it with: flux daemon start`);
    console.log(`Logs: journalctl --user -u ${LABEL} -n 50`);
    return;
  }

  // Get PID from systemd
  let pid: string | null = null;
  try {
    pid = execSync(`systemctl --user show -p MainPID --value ${LABEL}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (pid === "0") pid = null;
  } catch {
    // ignore
  }

  if (pid) {
    // Get uptime from /proc
    let uptime: string | null = null;
    try {
      const startTime = execSync(`ps -o lstart= -p ${pid}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (startTime) {
        const elapsedMs = Date.now() - new Date(startTime).getTime();
        uptime = formatSeconds(Math.floor(elapsedMs / 1000));
      }
    } catch {
      // ignore
    }
    console.log(`PID:    ${pid}${uptime ? ` (up ${uptime})` : ""}`);
  } else {
    console.log(`PID:    unknown`);
  }

  // Runtime health from /health endpoint
  try {
    const resp = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const health = (await resp.json()) as {
        version: string;
        uptime: number;
        projects: { total: number; idle: number; busy: number };
        sessions: number;
        memory: { rss: number };
      };
      console.log(`\n--- Runtime ---`);
      console.log(`Version:  ${health.version}`);
      console.log(`Uptime:   ${formatSeconds(health.uptime)}`);
      console.log(
        `Projects: ${health.projects.total} total (${health.projects.busy} busy, ${health.projects.idle} idle)`,
      );
      console.log(`Sessions: ${health.sessions} active`);
      console.log(`Memory:   ${health.memory.rss} MB RSS`);
    }
  } catch {
    console.log(`\n--- Runtime ---`);
    console.log(`Health:   unreachable (http://localhost:${port}/health)`);
    console.log(`          The process may still be starting up.`);
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

  console.log(`\nLive logs: journalctl --user -u ${LABEL} -f`);
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

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
