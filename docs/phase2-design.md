# Flux Phase 2: Design Document

**Status:** Draft  
**Last Updated:** February 2026  
**Phase:** Design Exploration (Post-MVP)

---

## Executive Summary

Following 100+ autonomous task completions via dog-fooding, Flux is ready for Phase 2. This document captures four major evolution areas: **Anvil Tools** (CLI-first extensibility), **Auto-Planning** (emergent vs prescriptive work), **Native Agent** (custom agent with direct API calls), and **Multi-Project Daemon** (always-on orchestration).

**Key Design Principle:** 
> "Code is cheap, understanding is expensive. Every decision is deliberate, every fallback explicit."

---

## 1. Anvil Tools: From MCP to CLI Convention

### Background

Anvil Tools originated from the forge/bellows game engine's "Anvil" MCP - a hot-loading protocol where agents could modify/extend tools and immediately use them without session reconnection. The insight: this pattern works better as a **CLI-first convention** rather than an MCP protocol.

### The CLI-Native Insight

**The problem with MCP:** It requires special client support, protocol implementation, session management, and static tool enumeration. When tools need to change dynamically, MCP forces session reconnection.

**The Anvil realization:** Agents are VERY GOOD at calling Bash. Every agent—Claude Code, Opencode, custom agents, even humans—can execute CLI commands. CLI is the universal interface.

Instead of exposing 30+ static MCP tools, expose **one CLI command** with dynamic sub-commands:

```bash
# Discovery - lists all available tools
$ flux anvil list
> issues.create
> issues.list
> orchestrator.run
> fontawesome.search

# Introspection - get schema for any tool
$ flux anvil describe issues.create
{
  "name": "issues.create",
  "description": "Create a new issue",
  "parameters": {
    "title": { "type": "string", "required": true },
    "description": { "type": "string" }
  }
}

# Execution with JSON I/O
$ flux anvil run issues.create --json '{"title": "foo"}'
{"id": "FLUX-42", "shortId": "FLUX-42", ...}
```

**Why this wins:**
- Works with ANY agent (no MCP protocol needed)
- Each invocation loads fresh tools from disk (no hot-reload complexity)
- Self-describing (agents can discover capabilities at runtime)
- Stateless (no persistent connections to manage)
- Composable (actions can call other actions internally)

### The Deep Engine Integration Vision

Anvil Tools expose a **simple CLI interface** to Flux and agents. What's underneath that CLI can be anything—from simple functions to complex integrations:

**CLI as the abstraction layer:**
```bash
# To the agent, it's always just:
$ flux anvil run <tool> --json '{...}'
```

**Implementation details are tool-specific:**
- `fontawesome.search` → Simple HTTP call to API
- `godot.scene_tree` → WebSocket to EditorPlugin running in Godot
- `rails.query` → HTTP to mounted Rails engine
- `issues.create` → Convex mutation

The CLI contract is simple and universal. The **implementation** handles the bespoke mechanisms required for deep integration.

**For a Godot game** (`~/Projects/forge`):
```gdscript
# anvil/anvil.gd - EditorPlugin loaded in Godot
# Internally connects to Bellows via WebSocket
# But to Flux, it's just CLI commands:

# Agent calls via Anvil CLI:
$ flux anvil run godot.scene_tree
{"root": {"name": "Main", "children": [{"name": "Player", "type": "CharacterBody2D"}]}}

$ flux anvil run godot.inspect_node --path "/root/Player"
{"scripts": ["player.gd"], "properties": {"health": 100, "speed": 300}}

$ flux anvil run godot.set_property --path "/root/Player" --property "speed" --value 400
{"previous": 300, "current": 400}
```
The CLI tool `godot.set_property` wraps the WebSocket communication with the EditorPlugin. The agent just sees a CLI command.

**For a Rails app:**
```ruby
# anvil/rails_engine.rb - Mountable engine
# Loads into Rails environment via HTTP
# But exposed as simple CLI:

$ flux anvil run rails.models
["User", "Post", "Comment"]

$ flux anvil run rails.model --name "User" --inspect
{"attributes": ["id", "email", "created_at"], "associations": ["has_many: posts"]}

$ flux anvil run rails.query --model "User" --where "created_at > ?" --args "2024-01-01"
[{"id": 1, "email": "foo@example.com"}]
```
The CLI commands wrap HTTP calls to the Rails engine. Simple interface, powerful implementation.

**For any language/framework:**
The agent writes Anvil tools that:
1. **Parse source code** to extract up-to-date API documentation
2. **Connect to runtimes** (WebSocket, HTTP, IPC) to introspect live state
3. **Execute and verify** behavior automatically
4. **Report results** as clean JSON via CLI

**The Verification Loop:**
The Flux agent never says *"okay done, try running X command to test it"*. The Flux agent:
1. **Already ran X** via CLI and verified it works
2. **If it doesn't work** → fixes it immediately
3. **If missing tools needed** → adds them (self-extending)
4. **If deeper integration required** → opens an issue to build that plugin

The agent **self-prioritizes** based on what it discovers it needs:
```
Working on feature X...
→ Needs to check database state
→ No `rails.query` tool available
→ Opens issue: "Add Rails query introspection to Anvil"
→ Either implements it or defers and finds workaround
```

This creates a **virtuous cycle:**
- Agent does work
- Discovers gaps in tooling
- Extends Anvil to fill gaps
- Future work becomes easier
- Agent becomes more capable over time

### Tool Schema Declaration (TBD)

**[DECISION REQUIRED]** How do Anvil tools declare their schema/interface for model understanding?

#### Option A: TypeScript-first with Zod

```typescript
// anvil/tools/fontawesome.ts
import { z } from "zod";
import { tool } from "@flux/anvil";

export const searchIcons = tool({
  name: "searchIcons",
  description: "Search FontAwesome icons by keyword or semantic meaning",
  parameters: z.object({
    query: z.string().describe("Search term (e.g., 'settings', 'arrow')"),
    style: z.enum(["solid", "regular", "brand"]).optional()
      .describe("Icon style variant")
  }),
  returns: z.array(iconSchema),
  handler: async ({ query, style }) => {
    // Implementation
  }
});
```

**Pros:**
- Single source of truth (schema + implementation)
- Type safety with runtime validation
- IDE autocomplete and refactoring support
- `zod-to-json-schema` for model consumption

**Cons:**
- Requires TypeScript runtime for introspection
- Potential cold-start overhead for tool discovery
- Ties us to Zod (though could abstract validator interface)

**Use When:** Strong TypeScript ecosystem preference, value of compile-time safety outweighs runtime introspection cost.

---

#### Option B: JSON Schema Sidecars (Convention-based)

```typescript
// anvil/tools/fontawesome.ts (implementation)
export async function searchIcons(params: SearchIconsParams): Promise<Icon[]> {
  // Implementation
}

// anvil/tools/fontawesome.schema.json (auto-generated or handwritten)
{
  "tools": {
    "searchIcons": {
      "description": "Search FontAwesome icons by keyword...",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search term..." },
          "style": { "enum": ["solid", "regular", "brand"] }
        },
        "required": ["query"]
      }
    }
  }
}
```

**Pros:**
- Language-agnostic (Python, Go, Rust tools can all use same pattern)
- Human-readable schema separate from implementation
- Can generate from any codebase
- Clear contract between tool author and model

**Cons:**
- Duplication risk (schema vs implementation)
- Can drift if not auto-generated
- Extra file to maintain

**Use When:** Multi-language ecosystem, need to support non-TypeScript tools, or prefer clear separation of concerns.

---

#### Option C: Self-Describing CLI Interface

```bash
# CLI introspection commands
$ flux anvil list
> fontawesome
> github
> project-specific

$ flux anvil describe fontawesome searchIcons
{
  "name": "searchIcons",
  "description": "Search FontAwesome icons...",
  "parameters": {
    "query": { "type": "string", "required": true },
    "style": { "enum": ["solid", "regular", "brand"], "required": false }
  },
  "examples": [
    { "query": "settings", "result": ["gear", "sliders"] }
  ]
}

$ flux anvil validate fontawesome searchIcons '{"query": "user"}'
> Valid ✓
```

**Pros:**
- CLI-native (fits Flux's CLI-first philosophy)
- Can introspect at runtime without compilation step
- Works with compiled/bundled code
- Can validate inputs before execution
- Natural fit for our CLI tool architecture

**Cons:**
- Requires running the tool to get schema (slower introspection)
- More complex to implement initially
- Tool must be loadable to describe itself

**Use When:** CLI-first workflow, need runtime discovery, or building tool marketplace/registry features.

---

#### Option D: Decorator/Annotation Pattern

```typescript
// anvil/tools/fontawesome.ts
import { anvilTool, anvilExample } from "@flux/anvil";

@anvilTool({
  description: "Search FontAwesome icons by keyword or semantic meaning",
  tags: ["ui", "icons"]
})
@anvilExample({
  input: { query: "settings" },
  output: ["gear", "sliders", "cog"],
  description: "Searching for 'settings' returns gear-related icons"
})
export async function searchIcons(
  @anvilParam("Search term") query: string,
  @anvilParam("Icon style", { optional: true }) style?: IconStyle
): Promise<Icon[]> {
  // Implementation
}
```

**Pros:**
- Clean, modern syntax (familiar to Next.js/NestJS developers)
- Metadata co-located with code
- Easy to scan and understand tool surface area
- Can generate JSON Schema from decorators at build time

**Cons:**
- Requires decorator support (TypeScript experimentalDecorators or tc39 proposal)
- Reflection metadata adds complexity
- Not all bundlers handle decorators well
- May feel "magical" compared to explicit schema

**Use When:** Team preference for decorator patterns, already using frameworks that leverage decorators.

---

#### Option E: Runtime Type Inference from Tests

```typescript
// anvil/tools/fontawesome.test.ts
import { searchIcons } from "./fontawesome";

describe("searchIcons", () => {
  it("finds gear icons for settings query", async () => {
    // This test becomes the schema example
    const result = await searchIcons({ query: "settings" });
    expect(result).toContain("gear");
    expect(result).toContain("sliders");
  });

  it("respects style parameter", async () => {
    const solid = await searchIcons({ query: "user", style: "solid" });
    expect(solid[0]).toMatch(/^fa-solid:/);
  });
});

// Flux extracts schema from test invocations
$ flux anvil extract-schema fontawesome
> Extracted schema from 3 test cases
```

**Pros:**
- Tests become living documentation
- Ensures all examples are valid (tested)
- No separate schema file to maintain
- Captures real usage patterns

**Cons:**
- Requires comprehensive test coverage
- Complex to implement test runner introspection
- Schema may be incomplete if tests don't cover all parameters
- Couples schema generation to test infrastructure

**Use When:** Test-driven development culture, want guaranteed-valid examples, or already have comprehensive tool tests.

---

#### Option F: Hybrid Approach (Recommended for Consideration)

Combine A + C:

1. **Development:** Use Zod schemas (Option A) for type safety and IDE support
2. **Runtime:** CLI introspection (Option C) for tool discovery
3. **Build Step:** `flux anvil build` generates manifest from Zod schemas
4. **Distribution:** Share tools via npm/Git with pre-built manifests

```typescript
// Development (TypeScript with Zod)
export const searchIcons = tool({
  parameters: z.object({ ... }),
  handler: async () => { ... }
});

// Generated at build time (manifest.json)
{
  "tools": {
    "fontawesome.searchIcons": {
      "schema": { /* JSON Schema */ },
      "examples": [ /* from tests */ ]
    }
  }
}

// Runtime CLI introspection
$ flux anvil list
$ flux anvil describe fontawesome searchIcons
```

**Pros:**
- Best of both worlds (type safety + runtime discovery)
- Build step catches schema/implementation drift
- Can distribute tools without source code
- Clear separation: Zod for dev, manifest for prod

**Cons:**
- More complex build pipeline
- Two concepts to understand (Zod schemas + manifests)

**Use When:** Want both developer experience (types) and operational flexibility (runtime).

---

### Tool Execution: Ephemeral Runner Pattern

The CLI-native approach pairs perfectly with the **Ephemeral Runner** architecture (see Native Agent section, Option C).

**Execution flow:**
```typescript
// Spawn fresh process per task
const result = await $`flux anvil run ${toolName} --json ${JSON.stringify(args)}`
return JSON.parse(result.stdout)
```

**Why this is perfect:**
1. **Latest tools automatically** - Each invocation loads from disk, no hot-reload needed
2. **Isolation** - Tool crashes don't affect other tasks or the daemon
3. **No state management** - Process exits cleanly after execution
4. **Simple to implement** - Standard child process spawning
5. **Agent-agnostic** - Works with Claude Code, Opencode, custom agents, or humans

**Comparison with persistent approaches:**

| Aspect | MCP Server | Persistent Agent | Ephemeral CLI |
|--------|------------|------------------|---------------|
| Tool updates | Requires reconnection | Hot-reload complexity | Fresh load every time |
| Crash isolation | Server crash kills session | Agent crash needs restart | Isolated per invocation |
| Implementation | Protocol compliance | State management | Simple subprocess |
| Agent support | MCP-compatible only | Custom integration | Universal (bash) |
| Overhead | Protocol serialization | In-memory registry | Process spawn (~50-100ms) |

**Mitigating spawn overhead:**
- Acceptable for tasks > few seconds (Flux tasks are typically minutes/hours)
- Can add caching layer for frequently-called read-only tools if needed
- Process pool pattern for high-frequency operations (future optimization)

---

### Multi-Agent Support

The CLI-native Anvil works with **any** agent without protocol adaptation:

**Claude Code:**
```json
{
  "mcpServers": {
    "flux": {
      "command": "flux",
      "args": ["mcp"],
      "env": { "FLUX_URL": "http://localhost:8042" }
    }
  }
}
```
Claude Code gets ONE MCP tool (`flux`) that internally calls `flux anvil run ...`

**Opencode:**
Direct bash calls:
```bash
$ flux anvil list
$ flux anvil run issues.create --title "Fix bug"
```

**Custom Native Agent:**
```typescript
// Spawn child process
const result = spawnSync('flux', ['anvil', 'run', toolName, '--json', JSON.stringify(args)])
return JSON.parse(result.stdout)
```

**Human CLI:**
Same commands work for direct human usage—no separate CLI tool needed.

---

### Tool Discovery & Loading (TBD)

**[DECISION REQUIRED]** How does Flux discover and load Anvil tools?

#### Option 1: Convention-based Discovery (npm/node_modules)

```
node_modules/
  @flux-tools/
    fontawesome/
      index.js
      manifest.json
    github/
      index.js
      manifest.json
  .flux-tools/ (local project tools)
    custom-deploy.ts
```

**Pattern:** Tools are npm packages under `@flux-tools/*` or local `.flux-tools/` directory. Flux scans `package.json` for `@flux-tools/*` deps.

**Pros:**
- Familiar npm ecosystem
- Semantic versioning
- Automatic dependency resolution
- Can publish/share tools easily

**Cons:**
- Requires npm install for new tools (can't hot-load)
- Node_modules bloat
- Version conflicts possible

---

#### Option 2: URL-based Discovery (Import Maps)

```typescript
// flux.config.ts
export default {
  anvil: {
    tools: [
      "https://tools.flux.dev/fontawesome@1.2.0",
      "https://tools.flux.dev/github@latest",
      "./tools/custom-deploy.ts" // local
    ]
  }
};
```

**Pattern:** Tools loaded via URL at runtime. Support https:// and file:// protocols. Can use import maps for versioning.

**Pros:**
- True hot-loading (change URL, restart agent)
- No npm install required
- Can load from GitHub gists, CDNs, etc.
- Built-in caching

**Cons:**
- Security concerns (loading remote code)
- Requires sandboxing
- Network dependency for tool loading

---

#### Option 3: Git Submodule/Subtree Pattern

```
.flux/anvil/
  shared/ (git submodule to flux-tools repo)
    fontawesome/
    github/
  project/ (project-specific, committed)
    custom-deploy.ts
```

**Pattern:** Shared tools via git submodules. Project-specific tools committed directly.

**Pros:**
- Version control of tool dependencies
- Works offline
- Easy to fork/modify shared tools
- No npm/registry dependency

**Cons:**
- Git complexity (submodules are painful)
- Manual updates
- Harder to share outside git context

---

#### Option 4: Plugin Registry (Centralized)

```bash
$ flux anvil install fontawesome
> Installing @flux-tools/fontawesome...
> Added to flux.config.ts

$ flux anvil publish ./tools/my-tool
> Publishing to registry.flux.dev...
> Published my-tool@1.0.0
```

**Pattern:** Central registry for tools (like VSCode extensions or Homebrew formulas).

**Pros:**
- Curated, trusted tools
- Easy discovery (`flux anvil search icons`)
- Can have official + community registries
- Analytics on tool usage

**Cons:**
- Centralization risk
- Maintenance burden
- Gatekeeping concerns

---

### Tool Modification & Extension (TBD)

**[DECISION REQUIRED]** How do agents modify/extend tools during retros?

#### Pattern A: Fork & Patch

Agent creates a copy of the tool, modifies it, and the new version shadows the original.

```
.flux/anvil/forks/fontawesome.ts (modified copy)
```

#### Pattern B: Composition/Wrapping

Agent creates a wrapper tool that calls the original.

```typescript
// my-search.ts
import { searchIcons as original } from "@flux-tools/fontawesome";

export async function searchIcons(params) {
  // Add caching layer
  // Or modify results
  return original(params);
}
```

#### Pattern C: Config-driven Behavior

Tools accept configuration that changes behavior without code changes.

```typescript
// flux.config.ts
{
  anvil: {
    tools: {
      fontawesome: {
        cache: true,
        cacheDuration: "1h",
        defaultStyle: "solid"
      }
    }
  }
}
```

---

## 2. Auto-Planning: Emergent vs Prescriptive

### Problem Statement

Spec-driven systems (BMAD, speckit, etc.) create **highly prescriptive work upfront**. This kills:
- Emergent ideas discovered during implementation
- Creative problem-solving
- Adaptability when original plan is insufficient

### Solution: Incremental Emergent Planning

**User establishes:**
- Design document (the "northstar")
- High-level milestones/epics as roadmap
- Pointer in project config: `designDoc: "./docs/design.md"`

**Flux continuously:**
- Monitors ticket state (pending/completed)
- References design doc for context
- **Incrementally extracts tickets** based on current understanding
- Allows implementation details to be flexible, adaptable, emergent

### Workflow

```
Phase 1: Milestone 1
  - Create ~12 tickets toward first milestone
  - No detailed specs, just direction
  
Phase 2: As Work Completes
  - System learns from completed work
  - Discovers gaps, challenges, opportunities
  - Agents extend Anvil tools as needed
  
Phase 3: Layer More Work
  - Create next batch of tickets
  - May refactor based on new learning
  - Continuous code reviews
  
Phase 4: Repeat Until Milestones Achieved
  - Design doc evolves with implementation
  - Roadmap adjusts based on reality
```

### Auto-Planning Toggle (TBD)

**[DECISION REQUIRED]** Per-project configuration for auto-planning behavior.

#### Option 1: Binary Toggle (On/Off)

```typescript
// flux.config.ts
{
  autoPlan: true // or false
}
```

- **On:** Continuously monitor and extract work
- **Off:** Manual ticket creation only

**Use When:** Simple mental model preferred, user wants direct control.

---

#### Option 2: Modes of Operation

```typescript
// flux.config.ts
{
  autoPlan: "aggressive" | "conservative" | "manual"
}
```

- **Aggressive:** Proactively creates work, suggests refactors, identifies tech debt
- **Conservative:** Only creates work when explicitly triggered or after milestone completion
- **Manual:** Disabled, user creates all tickets

**Use When:** Want gradations of autonomy, match to project phase.

---

#### Option 3: Trigger-based Configuration

```typescript
// flux.config.ts
{
  autoPlan: {
    enabled: true,
    triggers: {
      onIssueComplete: true,    // Review completed work
      onSchedule: "0 9 * * *", // Daily at 9am
      onMilestoneComplete: true, // After milestone done
      onCodeReview: "auto"     // After PR merged
    },
    constraints: {
      maxOpenIssues: 20,
      maxIssuesPerCycle: 5,
      requireApproval: false
    }
  }
}
```

**Use When:** Want fine-grained control over when and how much auto-planning occurs.

---

#### Option 4: Project Lifecycle States

```typescript
// flux.config.ts
{
  projectState: "active" | "paused" | "maintenance" | "archived"
}
```

- **Active:** Full auto-planning enabled
- **Paused:** No new work created, finish existing
- **Maintenance:** Only bug fixes and security updates
- **Archived:** Read-only, no work created

**Use When:** Managing multiple projects with different engagement levels.

---

### Recommendation

**Start with Option 1 (Binary Toggle) + Option 4 (Project States)**

Simple mental model that can evolve:

```typescript
// Phase 2 MVP
{
  projectState: "active" | "paused",  // Simple states
  autoPlan: true | false            // Simple toggle
}

// Future Evolution
// Can add modes, triggers, constraints as needed
```

---

## 3. Native Agent: Beyond CLI Wrappers

### Current State

- Claude Code (CC): ✅ Implemented
- Opencode: 📝 Planned
- Custom Native Agent: 🆕 Proposed

### Vision

Build our own agent from scratch:
- Custom system prompts
- Specialized tools
- Direct model provider API calls (OpenAI, Anthropic, etc.)
- Skip CLI tools (CC, Opencode) as intermediaries

**Strategy:** Build in parallel, keep all options. Benchmark native agent vs CC/Opencode with same PRD/roadmap across projects.

### Native Agent Architecture (TBD)

**[DECISION REQUIRED]** How should the native agent integrate with Flux?

#### Option A: Separate Node Process

```
Flux Daemon (Node)
  └── Agent Manager
      └── Native Agent Process (spawned, communicates via IPC)
          └── Anvil Tools
```

**Pros:**
- Isolation from main process
- Can restart agent without restarting Flux
- Crash in agent doesn't kill Flux
- Can scale to multiple agent processes

**Cons:**
- IPC complexity (messages, serialization)
- State synchronization overhead
- Harder to debug (two processes)

**Use When:** Reliability is paramount, want clear separation of concerns.

---

#### Option B: Built into Daemon (Worker Threads)

```
Flux Daemon (Node)
  ├── Main Thread (orchestration)
  └── Worker Threads (Native Agent)
      └── Shared Anvil Tool Registry
```

**Pros:**
- Shared memory (fast communication)
- Unified codebase
- Simpler deployment (single process)
- Can leverage Node.js Worker Threads for parallelism

**Cons:**
- Crash in agent kills Flux
- Harder to scale horizontally later
- Resource contention possible

**Use When:** Performance critical, want simplicity, not worried about crash isolation.

---

#### Option C: Hybrid - Ephemeral Tool Runner (Recommended)

```
Flux Daemon (Node) - Lean Orchestrator
  └── Per-Issue Spawns
      ├── Child Process 1 (Issue FLUX-42)
      │   ├── Native Agent Runtime
      │   ├── Fresh Anvil Tools (hot-loaded)
      │   └── Task Execution
      │   └── Exit (results reported)
      ├── Child Process 2 (Issue FLUX-43)
      └── ...
```

**Pros:**
- Clean isolation per task
- Stateless tasks = recoverable from crashes
- **Hot-reloading for free** (fresh process per task loads latest tools)
- Simple to implement and reason about
- Aligns with "task is unit of work" philosophy
- No persistent agent state to manage

**Cons:**
- Process spawn overhead (acceptable for tasks > few seconds)
- Context loss between tasks (can't easily "continue" conversation)

**Mitigations:**
- Spawn overhead is ~50-100ms on modern systems
- Tasks in Flux are typically minutes/hours long
- Can add "context persistence" layer if needed later

---

#### Option D: WASM-based Sandboxed Agents

```
Flux Daemon (Node)
  └── WASM Runtime (e.g., Wasmtime, Wasmer)
      └── Agent compiled to WASM
          └── WASI for system calls
          └── Limited capabilities
```

**Pros:**
- True sandboxing (security)
- Near-native performance
- Portable (can run in browser, edge functions)
- Memory safe

**Cons:**
- Complex build pipeline (Rust/Go → WASM)
- Limited ecosystem for AI agents in WASM
- Tool loading complexity
- Overkill for initial implementation

**Use When:** Security is critical, multi-platform deployment needed, or have WASM expertise.

---

#### Alignment with Ethos

| Principle | Option A | Option B | Option C | Option D |
|-----------|----------|----------|----------|----------|
| **Fail Fast** | ✓ (isolated) | ✗ (shared) | ✓✓ (per-task) | ✓ (sandboxed) |
| **YAGNI** | ✓ | ✓✓ | ✓✓✓ | ✗ (complex) |
| **Vertical Slices** | ✓ | ✓ | ✓✓✓ | ✓ |
| **Code Stewardship** | ✓ | ✓ | ✓✓ | ✓ |

**Strong Recommendation: Option C**

The ephemeral tool runner pattern gives us:
1. **Fail Fast for free** - task crashes, kill process, retry with fresh state
2. **No premature abstractions** - don't build complex agent infrastructure until needed
3. **Hot-reloading is automatic** - each task sees latest Anvil tools
4. **Scales naturally** - can run N tasks concurrently by spawning N processes
5. **Aligns with CLI philosophy** - each task is a "command" with fresh environment

**Future Evolution:**
```
Phase 2: Option C (Ephemeral Process)
Phase 3: Add Option B (Worker Threads) for "conversation mode"
Phase 4: Consider Option D (WASM) for untrusted tools
```

---

## 4. Multi-Project Daemon: Always-On Orchestration

### Current State

- Single project per Flux instance
- Orchestrator started/stopped with work
- Project path implicit from CWD

### Target State

- **One daemon process** across all projects
- **Projects as units** - can be running or not
- **Orchestrator always on** - persistent background process
- **Workers per project** - 1..n workers for issues on running projects
- **Agent CWD** - launched from project path

### Requirements

- Fault tolerant (crashes, reboots, laptop sleep)
- Personal tool - runs on user's computer
- Project paths stored, agents launch with appropriate CWD

### Architecture Changes (TBD)

**[DECISION REQUIRED]** Minimal changes needed to support multi-project.

#### Current (Single Project)

```typescript
// Global singleton state
const projectId = "implicit-from-cwd";

// Orchestrator starts/stops with work
// All queries assume single project context
```

#### Target (Multi-Project)

```typescript
// Remove projectId from global singleton
// Pass projectId explicitly in all operations

// Project state managed in Convex
interface Project {
  id: string;
  path: string;           // Absolute path
  name: string;
  state: "running" | "paused" | "stopped";
  autoPlan: boolean;
  config: ProjectConfig;
  createdAt: number;
  updatedAt: number;
}

// Workers track which project they're working on
interface Worker {
  id: string;
  projectId: string;
  issueId: string | null;
  status: "idle" | "working" | "error";
}
```

### UI Changes (TBD)

**[DECISION REQUIRED]** How to surface multi-project in the UI.

#### Option 1: Project Selector Dropdown

```
┌──────────────────────────────────────┐
│ 🔽 MyProject                    ⚙️  │  <- Project selector
├──────────────────────────────────────┤
│ Dashboard | Issues | Retro | Tools   │
├──────────────────────────────────────┤
│                                      │
│  Project-specific content...         │
│                                      │
└──────────────────────────────────────┘
```

**Use When:** Simple navigation, most users have <10 projects.

---

#### Option 2: Project Grid Dashboard

```
┌──────────────────────────────────────┐
│ All Projects                    +  │
├──────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐ │
│ │ MyProject    │  │ GameEngine   │ │
│ │ 🟢 Running   │  │ ⏸️ Paused   │ │
│ │ 12 issues    │  │ 3 issues     │ │
│ └──────────────┘  └──────────────┘ │
│ ┌──────────────┐                   │
│ │ SideProject  │                   │
│ │ 🔴 Stopped   │                   │
│ └──────────────┘                   │
└──────────────────────────────────────┘
```

Click project to enter project-specific view.

**Use When:** Visual overview of all projects, want status-at-a-glance.

---

#### Option 3: Sidebar Navigation

```
┌─────┬──────────────────────────────────┐
│     │                                  │
│ 📁  │  MyProject                       │
│ 🎮  │    Dashboard | Issues | Tools    │
│ 💼  │                                  │
│  +  │  [Project content]               │
│     │                                  │
└─────┴──────────────────────────────────┘
```

**Use When:** Many projects (10+), prefer sidebar navigation pattern.

---

#### Option 4: Unified Cross-Project View

```
┌──────────────────────────────────────┐
│ All Issues Across Projects      🔍  │
├──────────────────────────────────────┤
│ ┌─────────────────────────────────┐│
│ │ [MyProject] Implement auth      ││
│ │ [GameEngine] Fix collision bug  ││
│ │ [MyProject] Add tests           ││
│ └─────────────────────────────────┘│
└──────────────────────────────────────┘
```

**Use When:** Want to see all work in one place, prioritize across projects.

---

### Daemon Lifecycle (TBD)

**[DECISION REQUIRED]** How to manage the always-on daemon.

#### Option 1: OS Service/Systemd

```bash
# macOS
$ brew services start flux

# Linux
$ systemctl --user enable flux
$ systemctl --user start flux
```

**Pros:**
- Starts on boot
- Managed by OS
- Standard service tooling

**Cons:**
- OS-specific complexity
- Harder to debug
- Permission issues

---

#### Option 2: User-level Process Manager

```bash
$ flux daemon start
> Daemon started (PID: 12345)
> Logs: ~/.flux/logs/daemon.log

$ flux daemon status
> Running (PID: 12345, uptime: 3h 42m)

$ flux daemon stop
> Daemon stopped
```

**Pros:**
- Simple, user-controlled
- Cross-platform
- Easy to debug

**Cons:**
- Manual restart after reboot
- User must remember to start it

---

#### Option 3: Hybrid (Recommended)

**Development:**
```bash
$ flux dev          # Starts daemon + opens UI
# Manual control, easy to restart, debug
```

**Production/Personal:**
```bash
$ flux daemon install  # Creates OS service
$ flux daemon start    # Managed by OS
```

**Use When:** Flexibility for development, convenience for daily use.

---

## 5. Open Questions Summary

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Anvil Schema Declaration | A-F | **F (Hybrid) + CLI-native** - Zod for dev, CLI introspection for runtime, bash as universal interface |
| 2 | Auto-Planning Toggle | 1-4 | **1+4** - Binary + Project States |
| 3 | Native Agent Architecture | A-D | **C** - Ephemeral Tool Runner |
| 4 | Multi-Project UI | 1-4 | **2+3** - Grid dashboard + sidebar |
| 5 | Daemon Lifecycle | 1-3 | **3** - Hybrid approach |

---

## 6. Phase 2 Implementation Roadmap

### Phase 2A: Foundation (Weeks 1-2)

1. **Anvil Tool System**
   - Choose schema approach (TBD #1)
   - Implement tool discovery mechanism
   - Create 2-3 sample tools (FontAwesome, GitHub, etc.)

2. **Multi-Project Schema**
   - Convex schema updates (already ready)
   - Remove projectId singleton
   - Update all queries/mutations

### Phase 2B: Native Agent (Weeks 3-4)

1. **Ephemeral Agent Runtime**
   - Implement child process spawning
   - Tool loading from Anvil registry
   - Direct API calls to model providers

2. **Benchmarking**
   - Same PRD across CC/Native
   - Compare task completion rates
   - Measure tool usage patterns

### Phase 2C: UI & Experience (Weeks 5-6)

1. **Multi-Project UI**
   - Project grid dashboard
   - Project selector
   - Cross-project views

2. **Auto-Planning**
   - Design document parser
   - Ticket extraction logic
   - Per-project toggle UI

### Phase 2D: Hardening (Weeks 7-8)

1. **Fault Tolerance**
   - Crash recovery
   - Laptop sleep handling
   - Resume from reboot

2. **Daemon Lifecycle**
   - OS service integration
   - Background process management

---

## 7. Decision Log

| Date | Decision | Context | Status |
|------|----------|---------|--------|
| 2026-02-07 | Capture Phase 2 ideas | Post-MVP dog-fooding | ✅ Done |
| 2026-02-07 | Schema Declaration | Brainstorm options A-F | 📝 TBD |
| 2026-02-07 | Auto-Planning | Brainstorm options 1-4 | 📝 TBD |
| 2026-02-07 | Native Agent | Brainstorm options A-D | 📝 TBD |
| 2026-02-07 | Multi-Project UI | Brainstorm options 1-4 | 📝 TBD |
| 2026-02-07 | All Decisions | Awaiting selection | ⏳ Pending |
| 2026-02-08 | CLI-Native Anvil | Agents use bash universally, not MCP | ✅ Insight |
| 2026-02-08 | Deep Engine Vision | Anvil enables runtime introspection, not just CLI | ✅ Insight |

---

## 8. Appendix: Anvil Tool Example

```typescript
// anvil/tools/fontawesome.ts
import { z } from "zod";
import { tool } from "@flux/anvil";

const IconSchema = z.object({
  name: z.string(),
  unicode: z.string(),
  styles: z.array(z.enum(["solid", "regular", "brand"])),
  tags: z.array(z.string())
});

export const searchIcons = tool({
  name: "searchIcons",
  description: `Search FontAwesome icons by keyword or semantic meaning.
    
    Examples:
    - query: "settings" → returns "gear", "sliders", "cog"
    - query: "delete" → returns "trash", "trash-alt", "times"
    - query: "navigation" → returns "arrow-left", "arrow-right", "bars"`,
  
  parameters: z.object({
    query: z.string()
      .min(1)
      .max(50)
      .describe("Search term (e.g., 'settings', 'user', 'arrow')"),
    
    style: z.enum(["solid", "regular", "brand"])
      .optional()
      .describe("Filter by icon style. Omit to search all styles."),
    
    limit: z.number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum results to return")
  }),
  
  returns: z.array(IconSchema),
  
  examples: [
    {
      input: { query: "settings", limit: 5 },
      output: [
        { name: "gear", unicode: "f013", styles: ["solid"], tags: ["settings", "cog"] },
        { name: "sliders", unicode: "f1de", styles: ["solid"], tags: ["settings", "controls"] }
      ]
    }
  ],
  
  handler: async ({ query, style, limit }) => {
    // Implementation using FontAwesome GraphQL API
    const results = await searchFontAwesomeAPI({ query, style, limit });
    return results;
  }
});
```

---

## 9. Appendix: CLI-Native Anvil Example

The same FontAwesome tool, implemented as a CLI-native Anvil action:

```typescript
// anvil/tools/fontawesome.ts
import { z } from "zod";

// Schema exported for introspection
export const parameters = z.object({
  query: z.string()
    .min(1)
    .max(50)
    .describe("Search term (e.g., 'settings', 'user', 'arrow')"),
  
  style: z.enum(["solid", "regular", "brand"])
    .optional()
    .describe("Filter by icon style. Omit to search all styles."),
  
  limit: z.number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum results to return")
});

// Type inference from schema
export type SearchIconsParams = z.infer<typeof parameters>;

// Icon result type
export interface Icon {
  name: string;
  unicode: string;
  styles: Array<"solid" | "regular" | "brand">;
  tags: string[];
}

// Handler implementation
export async function handler(args: SearchIconsParams): Promise<Icon[]> {
  const { query, style, limit } = args;
  
  // Implementation using FontAwesome GraphQL API
  const results = await searchFontAwesomeAPI({ query, style, limit });
  return results;
}

// Optional: examples for documentation
export const examples = [
  {
    input: { query: "settings", limit: 5 },
    output: [
      { name: "gear", unicode: "f013", styles: ["solid"], tags: ["settings", "cog"] },
      { name: "sliders", unicode: "f1de", styles: ["solid"], tags: ["settings", "controls"] }
    ]
  }
];
```

**Usage across different agents:**

**Claude Code (via MCP):**
```json
// Claude Code calls the flux MCP tool
{ "tool": "flux", "action": "anvil.run", "toolName": "fontawesome.search", "args": { "query": "settings" } }
```

**Opencode (direct bash):**
```bash
$ flux anvil run fontawesome.search --json '{"query": "settings"}'
[{"name": "gear", "unicode": "f013", ...}]
```

**Custom Agent:**
```typescript
const result = spawnSync('flux', [
  'anvil', 'run', 'fontawesome.search', 
  '--json', JSON.stringify({ query: 'settings' })
]);
const icons = JSON.parse(result.stdout);
```

**Human CLI:**
```bash
$ flux anvil list | grep fontawesome
fontawesome.search - Search FontAwesome icons

$ flux anvil describe fontawesome.search
{"name": "fontawesome.search", "parameters": {...}}

$ flux anvil run fontawesome.search --query settings --limit 5
```

**Key differences from MCP approach:**
- No protocol wrapper needed
- Fresh process per invocation = latest code automatically
- Works identically across all agent types
- Humans use the same interface as agents

---

*End of Document*
