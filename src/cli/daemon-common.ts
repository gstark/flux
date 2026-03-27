import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABEL = "dev.flux.daemon";

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
