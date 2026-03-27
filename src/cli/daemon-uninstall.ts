import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import {
  plistPath as getPlistPath,
  IS_LINUX,
  isDaemonLoaded,
  LABEL,
} from "./daemon-common";
import { daemonUninstallLinux } from "./daemon-linux";

export async function daemonUninstall(): Promise<void> {
  if (IS_LINUX) return daemonUninstallLinux();

  const plist = getPlistPath();

  if (!existsSync(plist)) {
    console.log(
      `${LABEL} is not installed (${plist} does not exist). Nothing to do.`,
    );
    return;
  }

  // 1. Unload from launchd (stop the daemon)
  if (isDaemonLoaded()) {
    console.log(`Unloading ${LABEL}...`);
    execSync(`launchctl unload "${plist}"`, { stdio: "pipe" });
    console.log(`Unloaded ${LABEL}`);
  } else {
    console.log(`${LABEL} is not loaded in launchd (skipping unload)`);
  }

  // 2. Delete the plist file
  unlinkSync(plist);
  console.log(`Removed ${plist}`);

  // 3. Verify removal
  if (isDaemonLoaded()) {
    throw new Error(
      `${LABEL} is still registered with launchd after unload. Manual intervention may be needed.`,
    );
  }

  console.log(`\n✓ ${LABEL} has been uninstalled`);
  console.log(
    `\nNote: Log files at ~/.flux/logs/ have been preserved. Remove them manually if desired.`,
  );
}
