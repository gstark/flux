import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "./server";
import { loadProjects } from "./server/setup";

function ensureFluxBinOnPath(): void {
  const fluxBinDir = resolve(import.meta.dir, "../bin");
  const fluxScript = resolve(fluxBinDir, "flux");

  if (!existsSync(fluxScript)) {
    throw new Error(
      `Expected Flux CLI wrapper at ${fluxScript}, but it does not exist.`,
    );
  }

  const currentPath = process.env.PATH ?? "";
  const pathEntries = currentPath.split(":").filter(Boolean);
  if (pathEntries.includes(fluxBinDir)) {
    return;
  }

  process.env.PATH = currentPath
    ? `${fluxBinDir}:${currentPath}`
    : `${fluxBinDir}:/usr/bin:/bin`;
}

async function main() {
  ensureFluxBinOnPath();
  await loadProjects();
  const server = await startServer();
  console.log(`Flux running at http://localhost:${server.port}`);
}

void main();
