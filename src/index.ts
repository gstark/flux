import { startServer } from "./server";
import { ensureProject } from "./server/setup";

async function main() {
  const { projectId, projectSlug } = await ensureProject();
  const server = await startServer(projectId, projectSlug);
  console.log(`Flux running at http://localhost:${server.port}`);
}

void main();
