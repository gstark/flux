// CLI tool-call dispatch — maps `flux <group> <action>` to HTTP API calls.

import { readFluxConfig } from "../server/fluxConfig";
import { toolsByName } from "../server/tools/schema";

const FLUX_URL = process.env.FLUX_URL ?? "http://localhost:8042";

type ToolEntry = { tool: string; primary?: string; desc: string };

const TOOL_MAP: Record<string, ToolEntry> = {
  // Issues
  "issues create": { tool: "issues_create", desc: "Create a new issue" },
  "issues list": { tool: "issues_list", desc: "List issues (by status)" },
  "issues get": {
    tool: "issues_get",
    primary: "issueId",
    desc: "Get full issue details",
  },
  "issues update": {
    tool: "issues_update",
    primary: "issueId",
    desc: "Update an issue's fields",
  },
  "issues close": {
    tool: "issues_close",
    primary: "issueId",
    desc: "Close an issue",
  },
  "issues ready": { tool: "issues_ready", desc: "List issues ready for work" },
  "issues defer": {
    tool: "issues_defer",
    primary: "issueId",
    desc: "Defer an issue with a note",
  },
  "issues undefer": {
    tool: "issues_undefer",
    primary: "issueId",
    desc: "Undefer an issue",
  },
  "issues retry": {
    tool: "issues_retry",
    primary: "issueId",
    desc: "Reset a stuck issue for a fresh attempt",
  },
  "issues search": {
    tool: "issues_search",
    primary: "query",
    desc: "Search issues by title or short ID",
  },
  "issues list-by-session": {
    tool: "issues_list_by_session",
    primary: "sessionId",
    desc: "List issues created in a session",
  },
  "issues bulk-create": {
    tool: "issues_bulk_create",
    desc: "Create multiple issues at once",
  },
  "issues bulk-update": {
    tool: "issues_bulk_update",
    desc: "Update multiple issues at once",
  },

  // Comments
  "comments list": {
    tool: "comments_list",
    primary: "issueId",
    desc: "List comments on an issue",
  },
  "comments create": {
    tool: "comments_create",
    primary: "issueId",
    desc: "Add a comment to an issue",
  },

  // Epics
  "epics list": { tool: "epics_list", desc: "List epics" },
  "epics create": { tool: "epics_create", desc: "Create an epic" },
  "epics show": {
    tool: "epics_show",
    primary: "epicId",
    desc: "Show epic details with child issues",
  },
  "epics update": {
    tool: "epics_update",
    primary: "epicId",
    desc: "Update an epic",
  },
  "epics close": {
    tool: "epics_close",
    primary: "epicId",
    desc: "Close an epic",
  },

  // Labels
  "labels list": { tool: "labels_list", desc: "List all labels" },
  "labels create": { tool: "labels_create", desc: "Create a label" },
  "labels update": {
    tool: "labels_update",
    primary: "labelId",
    desc: "Update a label",
  },
  "labels delete": {
    tool: "labels_delete",
    primary: "labelId",
    desc: "Delete a label",
  },

  // Dependencies
  "deps add": { tool: "deps_add", desc: "Add a dependency between issues" },
  "deps remove": {
    tool: "deps_remove",
    desc: "Remove a dependency between issues",
  },
  "deps list": {
    tool: "deps_listForIssue",
    primary: "issueId",
    desc: "List dependencies for an issue",
  },

  // Sessions
  "sessions list": { tool: "sessions_list", desc: "List sessions" },
  "sessions list-by-issue": {
    tool: "sessions_list_by_issue",
    primary: "issueId",
    desc: "List sessions for an issue",
  },
  "sessions show": {
    tool: "sessions_show",
    primary: "sessionId",
    desc: "Show session details with transcript",
  },

  // Orchestrator
  "orchestrator run": {
    tool: "orchestrator_run",
    primary: "issueId",
    desc: "Trigger agent work on an issue",
  },
  "orchestrator kill": {
    tool: "orchestrator_kill",
    desc: "Kill the active agent session",
  },
  "orchestrator status": {
    tool: "orchestrator_status",
    desc: "Show orchestrator state",
  },

  // Prompts
  "prompts set-work": {
    tool: "prompts_set_work",
    desc: "Set custom work phase prompt",
  },
  "prompts set-retro": {
    tool: "prompts_set_retro",
    desc: "Set custom retro phase prompt",
  },
  "prompts set-review": {
    tool: "prompts_set_review",
    desc: "Set custom review phase prompt",
  },
  "prompts get": { tool: "prompts_get", desc: "Show custom prompts" },
  "prompts get-defaults": {
    tool: "prompts_get_defaults",
    desc: "Show default prompt templates",
  },
  "prompts reset": {
    tool: "prompts_reset",
    desc: "Reset prompts to defaults",
  },

  // Planner
  "planner status": {
    tool: "planner_status",
    desc: "Show planner status and last run",
  },
  "planner run": {
    tool: "planner_run",
    desc: "Trigger immediate planner run",
  },
};

const GROUPS: Record<string, string> = {
  issues: "Manage issues",
  comments: "Manage comments",
  epics: "Manage epics",
  labels: "Manage labels",
  deps: "Manage dependencies",
  sessions: "View sessions",
  orchestrator: "Control the orchestrator",
  prompts: "Configure agent prompts",
  planner: "Manage the project planner",
};

// ── Project ID Resolution ─────────────────────────────────────────────

async function gitRepoRoot(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  return text.trim();
}

async function prompt(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

type Project = { id: string; slug?: string; path?: string | null };

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${FLUX_URL}/api/projects`).catch(() => null);
  if (!res || !res.ok) {
    die(
      `Cannot reach Flux at ${FLUX_URL}. Is the daemon running?\n` +
        "  Start it: launchctl start dev.flux.daemon",
    );
  }
  return res.json();
}

/**
 * Interactive project picker — shown when no .flux file or env var is set
 * and multiple projects exist. Writes the selected project ID to .flux.
 * Only works in TTY sessions; non-interactive sessions get a clear error.
 */
async function pickProject(
  projects: Project[],
  repoRoot: string | null,
): Promise<string> {
  if (!process.stdin.isTTY) {
    die(
      "No Flux project configured for this repo.\n" +
        "Set FLUX_PROJECT_ID or create a .flux file at the repo root.\n" +
        `Available projects:\n${projects.map((p) => `  ${p.id}${p.slug ? ` (${p.slug})` : ""}`).join("\n")}`,
    );
  }

  console.error("No Flux project configured for this repo.\n");

  // Show existing projects
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const label = p.slug ?? p.id;
    const pathHint = p.path ? ` — ${p.path}` : "";
    console.error(`  ${i + 1}. ${label}${pathHint}`);
  }
  if (repoRoot) {
    console.error(`  n. Create new project for ${repoRoot}`);
  }
  console.error("");

  const maxChoice = projects.length;
  const validChoices = repoRoot ? `1-${maxChoice}, n` : `1-${maxChoice}`;

  const answer = await prompt(`Select project [${validChoices}]: `);

  // Create new project
  if (repoRoot && answer.toLowerCase() === "n") {
    return createProject(repoRoot);
  }

  // Select existing project
  const idx = Number.parseInt(answer, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= projects.length) {
    die(`Invalid selection: ${answer}`);
  }

  const selected = projects[idx];
  if (repoRoot) {
    await writeFluxFile(repoRoot, selected.id);
  }
  return selected.id;
}

async function createProject(repoRoot: string): Promise<string> {
  const res = await fetch(`${FLUX_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoRoot }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    die(`Failed to create project: ${(body as { error: string }).error}`);
  }

  const project = (await res.json()) as { id: string; slug: string };
  console.error(`Created project: ${project.slug} (${project.id})`);
  await writeFluxFile(repoRoot, project.id);
  return project.id;
}

async function writeFluxFile(repoRoot: string, projectId: string) {
  const fluxFile = `${repoRoot}/.flux`;
  await Bun.write(fluxFile, `${projectId}\n`);
  console.error(`Wrote ${fluxFile}`);
}

async function resolveProjectId(): Promise<string> {
  // 1. Explicit env var
  const explicit = process.env.FLUX_PROJECT_ID;
  if (explicit) return explicit;

  // 2. Read .flux file from git repo root (supports bare ID and TOML)
  const repoRoot = await gitRepoRoot();
  if (repoRoot) {
    const config = await readFluxConfig(repoRoot);
    if (config) return config.projectId;
  }

  // 3. Auto-discover or interactive pick
  const projects = await fetchProjects();

  if (projects.length === 0) {
    if (repoRoot) {
      return createProject(repoRoot);
    }
    die("No projects found. Create a project first, or set FLUX_PROJECT_ID.");
  }

  if (projects.length === 1) {
    const project = projects[0];
    // If we have a repo root, persist the selection
    if (repoRoot) {
      await writeFluxFile(repoRoot, project.id);
    }
    return project.id;
  }

  return pickProject(projects, repoRoot);
}

// ── Argument Parsing ──────────────────────────────────────────────────

function parseArgs(
  argv: string[],
  primaryField?: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let i = 0;

  if (primaryField && i < argv.length && !argv[i].startsWith("--")) {
    args[primaryField] = argv[i];
    i++;
  }

  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        args[key] = coerce(arg.slice(eqIdx + 1));
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          args[key] = true;
        } else {
          args[key] = coerce(next);
          i++;
        }
      }
    }
    i++;
  }

  return args;
}

function coerce(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

// ── Help ──────────────────────────────────────────────────────────────

function printToolsHelp(): void {
  console.log(`flux — CLI for the Flux issue tracker

Usage: flux <group> <command> [args] [options]

Groups:`);

  for (const [group, desc] of Object.entries(GROUPS)) {
    console.log(`  ${group.padEnd(16)}${desc}`);
  }

  console.log(`  ${"daemon".padEnd(16)}Manage the Flux daemon`);

  console.log(`
Run 'flux <group>' for subcommand help.
Run 'flux <group> <command> --help' for command options.

Issue IDs: Use short IDs (e.g. FLUX-42) or document IDs interchangeably.

Examples:
  flux issues list --status open
  flux issues get FLUX-42
  flux issues update FLUX-42 --title "New title" --priority high
  flux issues close FLUX-42 --closeType completed --reason "Fixed in PR #123"
  flux issues create --title "Fix login bug" --priority high
  flux issues create --title "Ship checkout v2" --epicId <epicDocId>
  flux issues update FLUX-42 --epicId <epicDocId>
  flux issues update FLUX-42 --epicId null            # detach from epic
  flux comments create FLUX-42 --content "Looks good"
  flux orchestrator run FLUX-42
  flux orchestrator status
  flux sessions show <sessionId>

Project: reads .flux file at git repo root, or set FLUX_PROJECT_ID.`);
}

function printGroupHelp(group: string): void {
  const desc = GROUPS[group];
  if (!desc) {
    console.error(
      `Unknown command: ${group}\nRun 'flux' for available commands.`,
    );
    process.exit(1);
  }

  console.log(`flux ${group} — ${desc}\n`);
  console.log("Commands:");

  for (const key of Object.keys(TOOL_MAP)) {
    if (!key.startsWith(`${group} `)) continue;
    const action = key.slice(group.length + 1);
    const entry = TOOL_MAP[key];
    const primaryHint = entry.primary ? ` <${entry.primary}>` : "";
    const usage = `${action}${primaryHint}`;
    console.log(`  ${usage.padEnd(28)}${entry.desc}`);
  }

  console.log(`\nRun 'flux ${group} <command> --help' for detailed options.`);
}

function printCommandHelp(
  group: string,
  action: string,
  entry: ToolEntry,
): void {
  const toolDef = toolsByName.get(entry.tool);
  const primaryHint = entry.primary ? ` <${entry.primary}>` : "";

  console.log(`flux ${group} ${action}${primaryHint} [options]`);
  if (toolDef) {
    console.log(`\n  ${toolDef.description}`);
  }

  const schema = toolDef?.schema;
  if (!schema || Object.keys(schema).length === 0) {
    console.log("\n  No options.");
    return;
  }

  console.log("\nOptions:");
  for (const [field, zodType] of Object.entries(schema)) {
    const zod = zodType as import("zod").ZodType;
    const desc = zod.description ?? "";
    const optional = zod.safeParse(undefined).success;
    const marker = entry.primary === field ? " (positional)" : "";
    const req = optional ? "" : " (required)";
    console.log(`  --${field.padEnd(20)}${desc}${req}${marker}`);
  }
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

// ── Public API ────────────────────────────────────────────────────────

/** Returns true if the first arg is a known tool group (or --help / no args). */
export function isToolCommand(args: string[]): boolean {
  if (args.length === 0) return true;
  const first = args[0];
  if (first === "--help" || first === "-h") return true;
  return first in GROUPS;
}

/** Run a tool command from argv (after slicing off the process args). */
export async function runToolCommand(argv: string[]): Promise<void> {
  // No args or --help → show help
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printToolsHelp();
    process.exit(0);
  }

  const group = argv[0];
  const action = argv[1];

  // Group only → show group help
  if (!action || action === "--help" || action === "-h") {
    printGroupHelp(group);
    process.exit(0);
  }

  // Look up the command
  const commandKey = `${group} ${action}`;
  const entry = TOOL_MAP[commandKey];
  if (!entry) {
    die(
      `Unknown command: flux ${group} ${action}\nRun 'flux ${group}' for available subcommands.`,
    );
  }

  // Subcommand help: flux <group> <action> --help (or --help anywhere in args)
  const rest = argv.slice(2);
  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(group, action, entry);
    process.exit(0);
  }

  // Parse remaining args
  const toolArgs = parseArgs(rest, entry.primary);

  // Resolve project ID
  const projectId = await resolveProjectId();
  const toolsUrl = `${FLUX_URL}/api/projects/${projectId}/tools`;

  // Call the API
  const response = await fetch(toolsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: entry.tool, args: toolArgs }),
  }).catch((err: Error) => {
    die(
      `Cannot reach Flux at ${FLUX_URL}: ${err.message}\n` +
        "Is the daemon running? Start it: launchctl start dev.flux.daemon",
    );
  });

  if (!response.ok) {
    const body = await response.text();
    die(`HTTP ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    content?: { type: string; text: string }[];
    isError?: boolean;
  };

  if (result.isError) {
    const raw =
      result.content?.map((c) => c.text).join("\n") ?? "Unknown error";
    try {
      const parsed = JSON.parse(raw);
      die(parsed.error ?? raw);
    } catch {
      die(raw);
    }
  }

  // Extract and pretty-print the response data
  const text = result.content?.map((c) => c.text).join("\n") ?? "";
  try {
    const data = JSON.parse(text);
    const output = data.data !== undefined ? data.data : data;
    console.log(JSON.stringify(output, null, 2));
  } catch {
    console.log(text);
  }
}
