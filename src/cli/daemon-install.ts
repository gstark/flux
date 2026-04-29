import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type DaemonInstallOpts,
  plistPath as getPlistPath,
  IS_LINUX,
  isDaemonLoaded,
  LABEL,
  resolvePorts,
  writeDaemonConfig,
} from "./daemon-common";
import { daemonInstallLinux } from "./daemon-linux";

export type { DaemonInstallOpts } from "./daemon-common";

/** Escape XML special characters for safe interpolation into plist values. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Read CONVEX_URL from env, falling back to .env.local in the project root. */
function resolveConvexUrl(): string {
  let convexUrl = process.env.CONVEX_URL;

  if (!convexUrl) {
    // Try loading from .env.local in the project root
    const envPath = join(projectRoot(), ".env.local");
    if (existsSync(envPath)) {
      const contents = readFileSync(envPath, "utf-8");
      for (const line of contents.split("\n")) {
        const match = line.match(/^(?:VITE_)?CONVEX_URL\s*=\s*(.+)/);
        const raw = match?.[1]?.trim();
        if (raw) {
          // Quoted values preserve literal content; unquoted values strip inline comments
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

/** Resolve the Flux project root (directory containing this source tree). */
function projectRoot(): string {
  // src/cli/daemon-install.ts → project root is two levels up
  return resolve(import.meta.dir, "../..");
}

/** Find the absolute path to the system bun binary (not node_modules shims). */
function resolveBunPath(): string {
  try {
    // `which -a` lists all matches; skip node_modules shims
    const all = execSync("which -a bun", { encoding: "utf-8" })
      .trim()
      .split("\n");
    const systemBun = all.find((p) => !p.includes("node_modules"));
    if (systemBun) return systemBun;
    // Fall back to first match if all are in node_modules (unlikely)
    if (all[0]) return all[0];
    throw new Error("no output");
  } catch {
    throw new Error(
      "Could not find bun binary. Ensure bun is installed and on your PATH.",
    );
  }
}

/** Generate the plist XML content. */
function generatePlist(opts: {
  /** The shell command to exec (e.g. "/path/to/bun run dev") */
  shellCommand: string;
  workingDirectory: string;
  logDir: string;
  envVars: {
    CONVEX_URL: string;
    FLUX_PORT: string;
    FLUX_VITE_PORT: string;
  };
}): string {
  const e = {
    label: escapeXml(LABEL),
    workDir: escapeXml(opts.workingDirectory),
    shellCmd: escapeXml(opts.shellCommand),
    convexUrl: escapeXml(opts.envVars.CONVEX_URL),
    fluxPort: escapeXml(opts.envVars.FLUX_PORT),
    fluxVitePort: escapeXml(opts.envVars.FLUX_VITE_PORT),
    logDir: escapeXml(opts.logDir),
  };

  // Launch through a login shell (`zsh -l -c`) so the user's full PATH from
  // .zshrc/.zprofile is available on every start — no need to snapshot PATH
  // at install time. Agents inherit this PATH and can find all user tools.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${e.label}</string>

	<key>WorkingDirectory</key>
	<string>${e.workDir}</string>

	<key>ProgramArguments</key>
	<array>
		<string>/bin/zsh</string>
		<string>-l</string>
		<string>-c</string>
		<string>exec ${e.shellCmd}</string>
	</array>

	<key>EnvironmentVariables</key>
	<dict>
		<key>CONVEX_URL</key>
		<string>${e.convexUrl}</string>
		<key>FLUX_PORT</key>
		<string>${e.fluxPort}</string>
		<key>FLUX_VITE_PORT</key>
		<string>${e.fluxVitePort}</string>
	</dict>

	<key>KeepAlive</key>
	<true/>

	<key>RunAtLoad</key>
	<true/>

	<key>StandardOutPath</key>
	<string>${e.logDir}/daemon.stdout.log</string>

	<key>StandardErrorPath</key>
	<string>${e.logDir}/daemon.stderr.log</string>

	<key>ExitTimeOut</key>
	<integer>90</integer>
</dict>
</plist>
`;
}

export async function daemonInstall(opts: DaemonInstallOpts = {}): Promise<void> {
  if (IS_LINUX) return daemonInstallLinux(opts);

  const root = projectRoot();
  const home = homedir();
  const plist = getPlistPath();
  const launchAgentsDir = join(home, "Library/LaunchAgents");
  const logDir = join(home, ".flux/logs");

  // 1. Resolve dependencies + ports
  const bunPath = resolveBunPath();
  const convexUrl = resolveConvexUrl();
  const { fluxPort, fluxVitePort } = resolvePorts(opts);
  const envVars = {
    CONVEX_URL: convexUrl,
    FLUX_PORT: String(fluxPort),
    FLUX_VITE_PORT: String(fluxVitePort),
  };
  const shellCommand = `${bunPath} run dev`;

  console.log(`Bun:             ${bunPath}`);
  console.log(`Shell:           /bin/zsh -l -c "exec ${shellCommand}"`);
  console.log(`CONVEX_URL:      ${envVars.CONVEX_URL}`);
  console.log(`FLUX_PORT:       ${envVars.FLUX_PORT}`);
  console.log(`FLUX_VITE_PORT:  ${envVars.FLUX_VITE_PORT}`);

  // 2. Ensure directories exist
  mkdirSync(logDir, { recursive: true });
  mkdirSync(launchAgentsDir, { recursive: true });

  // 3. If already loaded, unload first (idempotent reinstall)
  if (isDaemonLoaded()) {
    console.log(`Unloading existing ${LABEL}...`);
    execSync(`launchctl unload "${plist}"`, { stdio: "pipe" });
  }

  // 4. Write the plist
  const plistContent = generatePlist({
    shellCommand,
    workingDirectory: root,
    logDir,
    envVars,
  });
  writeFileSync(plist, plistContent);
  console.log(`Wrote ${plist}`);

  // 5. Persist port choice so status/start commands resolve the right URL
  writeDaemonConfig({ fluxPort, fluxVitePort });

  // 6. Load the plist
  execSync(`launchctl load "${plist}"`, { stdio: "pipe" });
  console.log(`Loaded ${LABEL}`);

  // 7. Verify
  if (!isDaemonLoaded()) {
    throw new Error(
      `Failed to verify ${LABEL} registration. Check: launchctl list | grep ${LABEL}`,
    );
  }
  console.log(`\n✓ ${LABEL} is registered with launchd`);

  console.log(
    `\nLogs:\n  stdout: ${logDir}/daemon.stdout.log\n  stderr: ${logDir}/daemon.stderr.log`,
  );
  console.log(`\nVerify: curl http://localhost:${envVars.FLUX_PORT}/health`);
}
