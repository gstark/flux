import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LABEL = "dev.flux.daemon";
const PLIST_FILENAME = `${LABEL}.plist`;

/** Escape XML special characters for safe interpolation into plist values. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Read CONVEX_URL and FLUX_PORT from env, falling back to .env.local in the project root. */
function resolveEnvVars(): { CONVEX_URL: string; FLUX_PORT: string } {
  const fluxPort = process.env.FLUX_PORT ?? "8042";
  let convexUrl = process.env.CONVEX_URL;

  if (!convexUrl) {
    // Try loading from .env.local in the project root
    const envPath = join(projectRoot(), ".env.local");
    if (existsSync(envPath)) {
      const contents = readFileSync(envPath, "utf-8");
      for (const line of contents.split("\n")) {
        const match = line.match(/^CONVEX_URL\s*=\s*(.+)/);
        const value = match?.[1];
        if (value) {
          // Strip surrounding quotes (single or double) common in .env files
          convexUrl = value.trim().replace(/^(['"])(.*)\1$/, "$2");
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

  return { CONVEX_URL: convexUrl, FLUX_PORT: fluxPort };
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
  bunPath: string;
  entryPoint: string;
  workingDirectory: string;
  logDir: string;
  envVars: { CONVEX_URL: string; FLUX_PORT: string };
}): string {
  const e = {
    label: escapeXml(LABEL),
    workDir: escapeXml(opts.workingDirectory),
    bun: escapeXml(opts.bunPath),
    entry: escapeXml(opts.entryPoint),
    convexUrl: escapeXml(opts.envVars.CONVEX_URL),
    fluxPort: escapeXml(opts.envVars.FLUX_PORT),
    logDir: escapeXml(opts.logDir),
  };

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
		<string>${e.bun}</string>
		<string>${e.entry}</string>
	</array>

	<key>EnvironmentVariables</key>
	<dict>
		<key>NODE_ENV</key>
		<string>production</string>
		<key>CONVEX_URL</key>
		<string>${e.convexUrl}</string>
		<key>FLUX_PORT</key>
		<string>${e.fluxPort}</string>
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

export async function daemonInstall(): Promise<void> {
  const root = projectRoot();
  const home = homedir();
  const launchAgentsDir = join(home, "Library/LaunchAgents");
  const plistPath = join(launchAgentsDir, PLIST_FILENAME);
  const logDir = join(home, ".flux/logs");
  const entryPoint = join(root, "src/index.ts");

  // 1. Resolve dependencies
  const bunPath = resolveBunPath();
  const envVars = resolveEnvVars();

  console.log(`Bun:       ${bunPath}`);
  console.log(`Entry:     ${entryPoint}`);
  console.log(`CONVEX_URL: ${envVars.CONVEX_URL}`);
  console.log(`FLUX_PORT:  ${envVars.FLUX_PORT}`);

  // 2. Ensure directories exist
  mkdirSync(logDir, { recursive: true });
  mkdirSync(launchAgentsDir, { recursive: true });

  // 3. If already loaded, unload first (idempotent reinstall)
  const isLoaded = (() => {
    try {
      execSync(`launchctl list ${LABEL}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();
  if (isLoaded) {
    console.log(`Unloading existing ${LABEL}...`);
    execSync(`launchctl unload ${plistPath}`, { stdio: "pipe" });
  }

  // 4. Write the plist
  const plist = generatePlist({
    bunPath,
    entryPoint,
    workingDirectory: root,
    logDir,
    envVars,
  });
  writeFileSync(plistPath, plist);
  console.log(`Wrote ${plistPath}`);

  // 5. Load the plist
  execSync(`launchctl load ${plistPath}`);
  console.log(`Loaded ${LABEL}`);

  // 6. Verify
  try {
    execSync(`launchctl list ${LABEL}`, { stdio: "pipe" });
    console.log(`\n✓ ${LABEL} is registered with launchd`);
  } catch {
    throw new Error(
      `Failed to verify ${LABEL} registration. Check: launchctl list | grep ${LABEL}`,
    );
  }

  console.log(
    `\nLogs:\n  stdout: ${logDir}/daemon.stdout.log\n  stderr: ${logDir}/daemon.stderr.log`,
  );
  console.log(`\nVerify: curl http://localhost:${envVars.FLUX_PORT}/health`);
}
