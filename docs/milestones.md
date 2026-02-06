## Milestones

- [ ] ### F1: Foundation — Scaffold + Convex + Issue CRUD

**Goal**: Standing project with Convex schema and working issue management via Convex functions.

**Work**:
- [ ] Initialize project: `bun init` in `tools/flux/`, set up package.json with React, Convex, Tailwind, DaisyUI
- [ ] `bunx convex init` (may need interactive setup)
- [ ] Implement full Convex schema (all tables above, including labels)
- [ ] Implement Convex functions as needed:
  - [ ] Start with `projects` (create, get) and `issues` (create, list, get, update)
  - [ ] Add `issues_claim` (atomic mutation - needed for orchestrator)
  - [ ] Defer the rest until their consuming feature is built
- [ ] Font Awesome Pro kit in index.html
- [ ] Bun.serve() entry point (`src/server/index.ts`) with HTML import for web, health endpoint, MCP route stub
- [ ] Convex Node client setup (`src/server/convex.ts`)
- [ ] Seed project record and default labels:
  ```typescript
  const DEFAULT_LABELS = [
    { name: "bug", color: "#dc2626" },      // red
    { name: "feature", color: "#2563eb" },  // blue
    { name: "chore", color: "#6b7280" },    // gray
    { name: "friction", color: "#f59e0b" }, // amber
  ];
  ```

**Checkpoint**: Can create/query/update issues and epics via Convex dashboard or `bunx convex run`.

---

- [ ] ### F2: MCP Server — Core Pattern

**Goal**: Establish the MCP tool pattern with minimal viable tools.

**Work**:
- [ ] MCP HTTP server on port 8042 using `@modelcontextprotocol/sdk`
- [ ] Implement pattern: `issues_create`, `issues_list`, `issues_get`
- [ ] `_meta` in responses (orchestrator status, timestamp)
- [ ] Register in `.mcp.json`
- [ ] Startup script: `bun run src/server/index.ts`

**Checkpoint**: Agent can create and view issues via MCP. Pattern established for adding tools as needed.

**Note**: Other tools (`epics_*`, `labels_*`, `comments_*`, `deps_*`, etc.) added when their consuming feature is built or at the end.

---

- [ ] ### F3a: Orchestrator — Manual Trigger

**Goal**: Issues can be executed manually via MCP, establishing the core lifecycle.

**Work**:
- [ ] Define `AgentProvider` interface and implement `ClaudeCodeProvider` — spawn `claude` CLI with stream-json
- [ ] Convex: `sessions` table and `sessions_create`, `sessions_update` mutations
- [ ] MCP tools: `orchestrator_run` (claim issue, spawn agent), `orchestrator_kill`, `sessions_list`
- [ ] Basic session recording (start time, status, PID)
- [ ] Simple close: mark done/failed based on exit code (no structured response yet)

**Checkpoint**: Call `orchestrator_run` via MCP → agent spawns → issue shows as `in_progress` → session record created → can kill via MCP.

---

- [ ] ### F3b: Orchestrator — Auto-Scheduler

**Goal**: Orchestrator automatically picks up ready issues.

**Work**:
- [ ] Scheduler — `ConvexClient.onUpdate()` subscription on `issues.ready` query
- [ ] Claim + spawn loop (atomic mutation with check)
- [ ] Recovery on startup — detect orphaned `in_progress` issues via `lastHeartbeat`, reset to `open`
- [ ] MCP tools: `orchestrator_enable`, `orchestrator_stop`, `orchestrator_status`

**Checkpoint**: `orchestrator_enable` → create issue → automatically claimed and worked. Stop → finishes current, then pauses.

---

- [ ] ### F3c: Orchestrator — Monitoring & Visibility

**Goal**: See what's happening in real-time.

**Work**:
- [ ] **Activity streaming**:
  - [ ] In-memory buffer (last 500 lines)
  - [ ] SSE endpoint (`/sse/activity`) for live output to browsers
  - [ ] Tmp file for crash recovery (`/tmp/flux-session-{id}.log`)
- [ ] Monitor — parse stream-json stdout, update `lastHeartbeat` every 30s
- [ ] MCP tool: `sessions_show` with basic transcript (last N lines from buffer)

**Checkpoint**: Watch live agent output streaming via SSE. Session shows recent transcript via MCP.

---

- [ ] ### F3d: Orchestrator — Feedback Loop

**Goal**: Complete lifecycle with retro, review, and quality control.

**Work**:
- [ ] **Structured response parsing** — parse `{"disposition": "done|noop|fault", "note": "..."}` from agent output
- [ ] **Disposition handling** per inference table (done → review, noop → close, fault → retry/fail)
- [ ] **Retro phase**: Resume same session with retro prompt → findings create follow-up issues with `sourceIssueId`
- [ ] **Review loop**: Stateless review sessions
  - [ ] Review gets diff (`startHead..HEAD`) and related issues list
  - [ ] If review makes commits → loop again (max iterations)
  - [ ] If no commits → pass, close issue
- [ ] Circuit breaker — `failureCount` tracking, stuck status when threshold hit
- [ ] MCP tool: `issues_unstick` (reset stuck issues to `open`)

**Checkpoint**: Full loop: auto-claim → work → retro → review → close (or stuck). Follow-up issues created from findings.

---

- [ ] ### F5a: React Frontend — Dog Food MVP

**Goal**: Absolute minimum UI to use the system end-to-end.

**Work**:
- [ ] React Router + Convex provider setup
- [ ] Tailwind + DaisyUI setup
- [ ] **Issues list**: table view, status filter, create modal
- [ ] **Issue detail**: edit title/description/status, close action
- [ ] **Orchestrator status bar**: shows running/idle + current issue
- [ ] **Enable/Stop controls**: buttons to start/stop the scheduler

**Checkpoint**: Can create issue, enable orchestrator, watch it claim and work on the issue, view results. Two tabs open — status updates in real-time.

---

- [ ] ### F5b: React Frontend — Observability

**Goal**: See what the agent is doing in real-time.

**Work**:
- [ ] **Live activity stream**: SSE to `/sse/activity`, terminal-style output
- [ ] **Sessions list**: basic table with status, issue ref, started time
- [ ] **Session detail**: transcript view (recent output), disposition if complete

**Checkpoint**: Watch agent output streaming live. Review completed sessions.

---

- [ ] ### F5c: React Frontend — Management Features

**Goal**: Richer issue management (defer, labels, comments, settings).

**Work**:
- [ ] Comments — display on issue detail, add form
- [ ] Labels — management page, assign to issues
- [ ] Dependencies — view blockers/blocked-by on issue detail
- [ ] Defer/Undefer — modals with optional note
- [ ] Settings — project config, scheduler config (focusEpicId, maxReviewIterations)
- [ ] Browser notifications for stuck/completed issues

**Checkpoint**: Full management capabilities. Can defer issues requiring human review, organize with labels, track dependencies.

---

- [ ] ### F6: Integration + Cutover (after F5b)

**Goal**: FLUX is fully integrated and ready for production use.

**Work**:
- [ ] Final `.mcp.json` configuration
- [ ] CLAUDE.md updates — document Flux MCP tools usage
- [ ] Agent system prompt templates — reference Flux tools
- [ ] Startup documentation / scripts
- [ ] End-to-end validation: create issue via MCP → enable orchestrator → session runs → retro → review loop → follow-ups created → view everything in UI

**Checkpoint**: Full autonomous loop works end-to-end. Agent creates issues, orchestrator runs sessions, feedback creates follow-ups, UI shows everything in realtime.
