import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABEL = "dev.flux.daemon";
export const PLIST_FILENAME = `${LABEL}.plist`;

/** Resolve the absolute path to the daemon's launchd plist file. */
export function plistPath(): string {
  return join(homedir(), "Library/LaunchAgents", PLIST_FILENAME);
}

/** Check whether the daemon is currently loaded in launchd. */
export function isDaemonLoaded(): boolean {
  try {
    execSync(`launchctl list ${LABEL}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
