import { startServer } from "./server";
import { loadProjects } from "./server/setup";

async function main() {
  const projects = await loadProjects();
  const server = await startServer(projects);
  console.log(`Flux running at http://localhost:${server.port}`);
}

void main();
