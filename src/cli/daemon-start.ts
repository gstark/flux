import { execSync } from "node:child_process";
import {
  IS_LINUX,
  isDaemonLoaded,
  LABEL,
  readDaemonConfig,
} from "./daemon-common";
import { daemonStartLinux } from "./daemon-linux";

export async function daemonStart(): Promise<void> {
  if (IS_LINUX) return daemonStartLinux();

  // Verify the daemon is loaded before attempting to start
  if (!isDaemonLoaded()) {
    console.error(
      `${LABEL} is not loaded in launchd. Run: flux daemon install`,
    );
    process.exit(1);
  }

  console.log(`Starting ${LABEL}...`);
  execSync(`launchctl start ${LABEL}`, { stdio: "pipe" });
  console.log(`Sent start signal to ${LABEL}.`);

  // Give the process a moment to spin up, then check status
  const { fluxPort } = readDaemonConfig();
  console.log(`\nVerify: curl http://localhost:${fluxPort}/health`);
  console.log(`Or run: flux daemon status`);
}
