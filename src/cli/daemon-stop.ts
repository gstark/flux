import { execSync } from "node:child_process";
import { IS_LINUX, isDaemonLoaded, LABEL } from "./daemon-common";
import { daemonStopLinux } from "./daemon-linux";

export async function daemonStop(): Promise<void> {
  if (IS_LINUX) return daemonStopLinux();

  // Verify the daemon is loaded before attempting to stop
  if (!isDaemonLoaded()) {
    console.error(`${LABEL} is not loaded in launchd. Nothing to stop.`);
    process.exit(1);
  }

  console.log(`Stopping ${LABEL}...`);
  execSync(`launchctl stop ${LABEL}`, { stdio: "pipe" });
  console.log(
    `Sent stop signal to ${LABEL}. The job remains loaded — launchd will restart it per KeepAlive policy.`,
  );
  console.log(`\nTo check status: flux daemon status`);
}
