import { execSync } from "node:child_process";

const LABEL = "dev.flux.daemon";

export async function daemonStart(): Promise<void> {
  // Verify the daemon is loaded before attempting to start
  try {
    execSync(`launchctl list ${LABEL}`, { stdio: "pipe" });
  } catch {
    console.error(
      `${LABEL} is not loaded in launchd. Run: flux daemon install`,
    );
    process.exit(1);
  }

  console.log(`Starting ${LABEL}...`);
  execSync(`launchctl start ${LABEL}`, { stdio: "pipe" });
  console.log(`Sent start signal to ${LABEL}.`);

  // Give the process a moment to spin up, then check status
  const port = process.env.FLUX_PORT ?? "8042";
  console.log(`\nVerify: curl http://localhost:${port}/health`);
  console.log(`Or run: flux daemon status`);
}
