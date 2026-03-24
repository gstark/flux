import { daemonInstall } from "./cli/daemon-install";
import { daemonStart } from "./cli/daemon-start";
import { daemonStatus } from "./cli/daemon-status";
import { daemonStop } from "./cli/daemon-stop";
import { daemonUninstall } from "./cli/daemon-uninstall";
import { mcpSmokeFollowup } from "./cli/mcp-smoke-followup";
import { isToolCommand, runToolCommand } from "./cli/tools";

const args = process.argv.slice(2);

// Tool commands (issues, comments, epics, etc.) take priority
if (isToolCommand(args)) {
  await runToolCommand(args);
} else {
  // Daemon and utility commands
  const command = args.join(" ");
  switch (command) {
    case "daemon install":
      await daemonInstall();
      break;
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
