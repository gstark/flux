import { daemonInstall } from "./cli/daemon-install";
import { daemonStart } from "./cli/daemon-start";
import { daemonStatus } from "./cli/daemon-status";
import { daemonStop } from "./cli/daemon-stop";
import { daemonUninstall } from "./cli/daemon-uninstall";
import { mcpSmokeFollowup } from "./cli/mcp-smoke-followup";
import { isToolCommand, runToolCommand } from "./cli/tools";

const args = process.argv.slice(2);

/**
 * Parse `--name value` and `--name=value` flags off `args`, returning the
 * matched value (string) or undefined. Mutates `args` to remove the flag.
 */
function takeFlag(args: string[], name: string): string | undefined {
  const long = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === long) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${long}`);
      }
      args.splice(i, 2);
      return value;
    }
    if (arg !== undefined && arg.startsWith(`${long}=`)) {
      const value = arg.slice(long.length + 1);
      args.splice(i, 1);
      return value;
    }
  }
  return undefined;
}

/** Parse a boolean `--name` flag. Returns true if present, false otherwise. */
function takeBoolFlag(args: string[], name: string): boolean {
  const long = `--${name}`;
  const idx = args.indexOf(long);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function parsePort(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid ${flag}: "${raw}" (must be an integer 1–65535)`);
  }
  return n;
}

// Tool commands (issues, comments, epics, etc.) take priority
if (isToolCommand(args)) {
  await runToolCommand(args);
} else if (args[0] === "daemon" && args[1] === "install") {
  // Strip subcommand, parse port flags from the rest
  const installArgs = args.slice(2);
  const fluxPortRaw = takeFlag(installArgs, "port");
  const fluxVitePortRaw = takeFlag(installArgs, "vite-port");
  const prodMode = takeBoolFlag(installArgs, "prod");
  if (installArgs.length > 0) {
    console.error(
      `Unknown argument(s) for 'daemon install': ${installArgs.join(" ")}`,
    );
    console.error(
      `Usage: flux daemon install [--prod] [--port N] [--vite-port N]`,
    );
    process.exit(1);
  }
  await daemonInstall({
    fluxPort:
      fluxPortRaw === undefined ? undefined : parsePort(fluxPortRaw, "--port"),
    fluxVitePort:
      fluxVitePortRaw === undefined
        ? undefined
        : parsePort(fluxVitePortRaw, "--vite-port"),
    mode: prodMode ? "prod" : "dev",
  });
} else {
  // Daemon and utility commands (no flags)
  const command = args.join(" ");
  switch (command) {
    case "daemon uninstall":
      await daemonUninstall();
      break;
    case "daemon status":
      await daemonStatus();
      break;
    case "daemon stop":
      await daemonStop();
      break;
    case "daemon start":
      await daemonStart();
      break;
    case "mcp smoke-followup":
      await mcpSmokeFollowup();
      break;
    default:
      console.error(
        `Unknown command: ${command}\nRun 'flux' for available commands.`,
      );
      process.exit(1);
  }
}
