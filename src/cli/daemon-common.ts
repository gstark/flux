import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LABEL = "dev.flux.daemon";

export const DEFAULT_FLUX_PORT = 8042;
export const DEFAULT_FLUX_VITE_PORT = 8043;

// ---------------------------------------------------------------------------
// Daemon config — persists chosen ports across CLI invocations
// ---------------------------------------------------------------------------

export type DaemonConfig = {
  fluxPort: number;
  fluxVitePort: number;
};

/** Resolve the absolute path to the persisted daemon config JSON. */
export function daemonConfigPath(): string {
  return join(homedir(), ".flux/daemon.json");
}

/**
 * Read the persisted daemon config written by `flux daemon install`.
 * Falls back to env vars (FLUX_PORT, FLUX_VITE_PORT), then to defaults.
 *
 * Used by status/start/stop so commands hit the correct port even when the
 * shell that invokes the CLI doesn't have FLUX_PORT exported.
 */
export function readDaemonConfig(): DaemonConfig {
  const path = daemonConfigPath();
  if (existsSync(path)) {
    const parsed = JSON.parse(
      readFileSync(path, "utf-8"),
    ) as Partial<DaemonConfig>;
    if (
      typeof parsed.fluxPort !== "number" ||
      typeof parsed.fluxVitePort !== "number"
    ) {
      throw new Error(
        `Corrupt daemon config at ${path}: expected { fluxPort: number, fluxVitePort: number }`,
      );
    }
    return { fluxPort: parsed.fluxPort, fluxVitePort: parsed.fluxVitePort };
  }
  return {
    fluxPort: Number(process.env.FLUX_PORT) || DEFAULT_FLUX_PORT,
    fluxVitePort: Number(process.env.FLUX_VITE_PORT) || DEFAULT_FLUX_VITE_PORT,
  };
}

/** Persist the daemon config so future CLI commands resolve the right ports. */
export function writeDaemonConfig(cfg: DaemonConfig): void {
  const path = daemonConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Install-time port resolution (shared by macOS + Linux installers)
// ---------------------------------------------------------------------------

export type DaemonMode = "dev" | "prod";

export type DaemonInstallOpts = {
  /** API/server port (FLUX_PORT). Falls back to env, then default 8042. */
  fluxPort?: number;
  /**
   * Vite dev-server port (FLUX_VITE_PORT). When omitted and `fluxPort` is
   * supplied, defaults to `fluxPort + 1` so the second port shifts with the
   * first instead of colliding with an unrelated default.
   */
  fluxVitePort?: number;
  /**
   * Run mode. "dev" (default) starts `bun run dev` (watch + vite + convex dev).
   * "prod" starts `bun run start` — serves the pre-built `dist/` and expects
   * CONVEX_URL to point at a deployed Convex backend.
   */
  mode?: DaemonMode;
};

/**
 * Resolve and validate the (fluxPort, fluxVitePort) pair from CLI opts/env.
 * Throws if the two ports collide — a duplicate would silently break the
 * Bun↔Vite reverse-proxy and is never what the user wants.
 */
export function resolvePorts(opts: DaemonInstallOpts): DaemonConfig {
  const fluxPort =
    opts.fluxPort ?? (Number(process.env.FLUX_PORT) || DEFAULT_FLUX_PORT);

  const envVite = Number(process.env.FLUX_VITE_PORT);
  const fluxVitePort =
    opts.fluxVitePort ??
    (opts.fluxPort !== undefined
      ? opts.fluxPort + 1
      : envVite ||
        (fluxPort === DEFAULT_FLUX_PORT
          ? DEFAULT_FLUX_VITE_PORT
          : fluxPort + 1));

  for (const [name, value] of [
    ["fluxPort", fluxPort],
    ["fluxVitePort", fluxVitePort],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`Invalid ${name}: ${value} (must be 1–65535)`);
    }
  }

  if (fluxPort === fluxVitePort) {
    throw new Error(
      `FLUX_PORT (${fluxPort}) and FLUX_VITE_PORT (${fluxVitePort}) must be different — ` +
        `Bun and Vite cannot share a port. Pass --vite-port to override.`,
    );
  }

  return { fluxPort, fluxVitePort };
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export const IS_LINUX = process.platform === "linux";
export const IS_MACOS = process.platform === "darwin";

// ---------------------------------------------------------------------------
// macOS helpers (launchd)
// ---------------------------------------------------------------------------

const PLIST_FILENAME = `${LABEL}.plist`;

/** Resolve the absolute path to the macOS launchd plist file. */
export function plistPath(): string {
  return join(homedir(), "Library/LaunchAgents", PLIST_FILENAME);
}

/** Check whether the daemon is currently loaded in launchd (macOS). */
export function isDaemonLoadedMacos(): boolean {
  try {
    execSync(`launchctl list ${LABEL}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Linux helpers (systemd)
// ---------------------------------------------------------------------------

const SERVICE_FILENAME = `${LABEL}.service`;

/** Resolve the absolute path to the systemd user service file (Linux). */
export function servicePath(): string {
  return join(homedir(), ".config/systemd/user", SERVICE_FILENAME);
}

/** Check whether the daemon service unit file exists on disk (Linux). */
export function isServiceInstalledLinux(): boolean {
  return existsSync(servicePath());
}

/** Check whether the daemon service is active (Linux). */
export function isDaemonActiveLinux(): boolean {
  try {
    execSync(`systemctl --user is-active ${LABEL}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Unified helper — used by daemon-start/stop/status/uninstall
// ---------------------------------------------------------------------------

/**
 * Returns true if the daemon is considered "loaded/registered" on this platform.
 * On macOS: loaded in launchd.
 * On Linux: service unit file exists on disk.
 */
export function isDaemonLoaded(): boolean {
  if (IS_LINUX) return isServiceInstalledLinux();
  return isDaemonLoadedMacos();
}
