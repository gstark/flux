# FLUX

> **Note:** `AGENTS.md` is a symlink to this file. Do not create a separate `AGENTS.md` — edit `CLAUDE.md` only.

An autonomous agent orchestrator with built-in issue tracking, realtime UI, and its own MCP server.

- See [design.md](docs/design.md) for project overview and architecture.

## Core Principles: Coding With Intent

**CRITICAL:** This methodology must be applied to ALL code. No exceptions.

Code is cheap, understanding is expensive.

### Bold & Deliberate Implementation

- Every action has a clear, specific purpose.
- No "hoping it works" — we **KNOW** what each line does.
- Do not write code you do not understand.

### NO SILENT FALLBACKS

- **Fail Fast:** If something fails, we want to know immediately and why.
- Fallbacks must be explicit, documented decisions — never implicit.
- Never hide problems behind "it might work anyway" logic.
- **No Logging-Only Errors:** Logging an error and continuing is a silent failure. If you catch an error and only log it, the program continues in a broken state. Either propagate the error, crash the specific subsystem, or set a flag the caller **must** check.
- **No Legacy Safety Nets:** Never leave "backwards compatibility" fallback code. It masks bugs and delays detection of real issues. If you refactor, DELETE the old path entirely. If the new path breaks, the engine _should_ break so we can fix it.

### Intentional Architecture

- Each component has a single, clear responsibility.
- Every decision point is traceable and debuggable.

### Code Stewardship

Every file you touch should be slightly better than when you found it.

- **Refactor Proactively:** If you're modifying code near something that could be cleaner, fix it. Don't leave broken windows.
- **Use Modern APIs:** When a framework or library has a better way to do something, adopt it. Don't cling to deprecated patterns.
- **No Lazy TODOs:** If you can't fix it now, leave a `// TODO:` explaining _why_ and _what_ is missing.
- **Don't Be Lazy:** Taking shortcuts creates technical debt that compounds.

## Vertical Slices & YAGNI

**Build only what you need RIGHT NOW.** No exceptions.

- **Vertical Slices:** Implement complete features end-to-end before starting new ones. Don't build "foundations" you think you'll need later.
- **No Future-Proofing:** Don't add tables, fields, or indexes "just in case." If the query doesn't exist yet, the index doesn't exist yet.
- **Defer Abstractions:** Don't build complex systems (orchestrators, configs, sessions) before their consumers exist. Build the consumer first, extract patterns second.
- **Schema Minimalism:** Start with the smallest schema possible. Every table and field must justify its existence with active code that uses it.

**Example:** An initial agent attempt created 9 tables with 10 indexes. We pared it down to 2 tables with 2 indexes because the rest were speculative features not needed for the current milestone.

## Convex Schema Design

**Schema is not a contract with the future. It's a reflection of current needs.**

- **Single Source of Truth:** Export const enums and validators from `schema.ts`. Reuse them in queries/mutations. Never copy-paste `v.union(v.literal(...))` patterns.
- **Fail Fast on Schema Changes:** Schema changes should break existing code immediately. Don't add backwards compatibility fallbacks. Fix the code.
- **No Storing Computed Data:** Don't store values that can be derived at runtime (e.g., `repoPath`). Compute at the edge (CLI), store only canonical data.
- **Indexes When Needed, Not Before:** Add indexes only when you have real queries that will filter or sort on that field. We use indexes—just not arbitrarily. If a query needs to filter by `projectId`, add the index when writing that query.
- **Add Fields When Building Features:** Don't add fields like `deletedAt` until you're actually implementing soft delete functionality. Schema grows with features, not ahead of them.

### Schema Migrations (optional → required)

When promoting a field from `v.optional(...)` to required, existing documents without the field will block `convex deploy` with schema validation errors. **Never** make the field required and push — the deploy will fail.

**Required workflow:**

1. **Write the migration** in `convex/migrations.ts` — an idempotent `internalMutation` that backfills the field on all documents missing it.
2. **Keep the field optional** in `schema.ts` (or temporarily make it optional if it's already required).
3. **Push the schema** so the migration can run: `bunx convex dev --once`
4. **Run the migration**: `bunx convex run migrations:<name>`
5. **Promote the field to required** in `schema.ts`.
6. **Push again**: `bunx convex dev --once` — now all documents satisfy the required constraint.

**Migration rules:**
- Each migration must be **idempotent** — safe to re-run without side effects.
- Use `internalMutation` so migrations are only callable from the CLI, not from clients.
- Fail fast on unexpected data (unknown enum values, missing derived fields).
- Return a summary: `{ patched, skipped, total }` for verification.

**Example:** See `convex/migrations.ts:backfillPriorityOrder` — backfills `priorityOrder` from `priority` for FLUX-207.

**Pattern:**
```typescript
// schema.ts - export for reuse
export const IssueStatus = { Open: "open", ... } as const;
export const issueStatusValidator = v.union(
  v.literal(IssueStatus.Open),
  ...
);

// queries.ts - import and reuse
import { IssueStatus, issueStatusValidator } from "./schema";
```

## Development Guidelines

**Important**: `bun dev` starts three processes via `concurrently`:
1. **Bun** (`:8042`) — API server (`/api/*`, `/mcp/projects/*`, `/sse/*`, `/health`)
2. **Convex** — backend sync
3. **Vite** (`:5173`) — React SPA with HMR via `@tailwindcss/vite`

Open the app at `http://localhost:5173` during development. Vite proxies API requests to Bun automatically. Code changes to `src/` trigger a full process restart via `bun --watch` (reliable for transitive dependencies); changes to `convex/` are deployed by `convex dev`. If a restart gets stuck, see "Restarting the Daemon" below.

For production: `bun run build:frontend` builds to `dist/`, then `bun run start` serves the static files from Bun at `:8042`.

Default to using Bun instead of Node.js.

Read the Bun API docs in `node_modules/bun-types/docs/**.mdx`

Do not add any new dependencies without asking first. This requires explicit permission from the user.

### Restarting the Daemon

The daemon runs as a macOS LaunchAgent (`dev.flux.daemon`) with `KeepAlive: true`. To restart:

```bash
launchctl stop dev.flux.daemon
```

launchd automatically restarts the process. No need to run `start` — KeepAlive handles it.

**When to restart:**
- Hot reload is stuck (code changes not reflected after a few seconds)
- `convex dev` lost connection
- Server is in a bad state

**No need to wait for active sessions.** Session recovery on startup handles everything:
- Live agent PIDs are re-adopted transparently
- Dead PIDs are detected, sessions marked failed, issues reopened
- In-progress issues with no live session are reopened

**Verify the restart:**

```bash
curl http://localhost:8042/health
tail -20 ~/.flux/logs/daemon.stdout.log
```

### Git & Auto-Commit

The orchestrator auto-commits any dirty working tree after each session phase (work, retro, review) via `autoCommitDirtyTree()` in `src/server/git.ts`. This safety net catches uncommitted changes, but uses a generic commit message.

**Agents must commit their own changes before exiting.** Always use a single atomic command to prevent the auto-commit from racing between `git add` and `git commit`:

```bash
# CORRECT: atomic add + commit
git add src/foo.ts src/bar.ts && git commit -m "FLUX-XX: Descriptive message"

# WRONG: separate tool calls — auto-commit can fire between them
git add src/foo.ts src/bar.ts   # ← orchestrator may auto-commit here
git commit -m "FLUX-XX: ..."    # ← nothing left to commit
```

## UI Component Patterns (Biome A11y)

Biome's recommended a11y rules are enabled. These patterns cause repeated lint failures when agents don't follow them upfront. Get them right on the first pass.

### No `autoFocus` prop — use `useRef` + `useEffect`

Biome's `noAutofocus` rule bans the `autoFocus` prop. Use a ref instead:

```tsx
// WRONG — biome error: noAutofocus
<input autoFocus />

// CORRECT
const inputRef = useRef<HTMLInputElement>(null);
useEffect(() => { inputRef.current?.focus(); }, []);
<input ref={inputRef} />
```

### Non-null assertions in closures — capture to a `const`

Biome's `noNonNullAssertion` catches `ref.current!` and `state!` patterns. After a null guard, capture to a local const:

```tsx
// WRONG — biome error: noNonNullAssertion
if (!dialogRef.current) return;
dialogRef.current!.close();

// CORRECT — capture after guard
const dialog = dialogRef.current;
if (!dialog) return;
dialog.close();
```

### `onClick` on non-interactive elements needs `onKeyDown`

Biome's `useKeyWithClickEvents` requires keyboard support alongside click handlers on non-interactive elements. Prefer using `<button>` instead of adding `onKeyDown` to a `<div>`:

```tsx
// WRONG — biome error: useKeyWithClickEvents
<div onClick={handleClick}>Click me</div>

// WRONG — patching a div with keyboard handler
<div onClick={handleClick} onKeyDown={handleKey} tabIndex={0} role="button">

// CORRECT — use a real button
<button type="button" onClick={handleClick} className="btn">Click me</button>
```

### Use semantic elements, not ARIA roles on `<div>`

Biome's `noNoninteractiveElementToInteractiveRole` bans adding interactive roles like `role="button"` to `<div>`, `<h2>`, etc. Use the actual interactive element:

```tsx
// WRONG — biome error: noNoninteractiveElementToInteractiveRole
<div role="button" onClick={handleClick}>Save</div>
<h2 role="button" onClick={toggle}>Toggle</h2>

// CORRECT
<button type="button" onClick={handleClick}>Save</button>
<button type="button" onClick={toggle} className="text-xl font-bold">Toggle</button>
```

Exception: `role="alert"` on `<div>` is fine — it's a live-region role, not interactive.

### Labels need `htmlFor` + matching `id`

Biome's `noLabelWithoutControl` requires labels to reference their input. Use DaisyUI's `fieldset`/`legend` pattern when possible, or explicit `htmlFor`:

```tsx
// WRONG — biome error: noLabelWithoutControl
<label>Email</label>
<input type="email" />

// CORRECT — htmlFor + id
<label htmlFor="email-input">Email</label>
<input id="email-input" type="email" />

// PREFERRED — DaisyUI fieldset (no htmlFor needed)
<fieldset className="fieldset">
  <legend className="fieldset-legend">Email</legend>
  <input type="email" className="input input-bordered w-full" />
</fieldset>
```

### Quick reference

| Biome Rule | Fix |
|---|---|
| `noAutofocus` | `useRef` + `useEffect` instead of `autoFocus` prop |
| `noNonNullAssertion` | Capture to a `const` after null guard |
| `useKeyWithClickEvents` | Use `<button>` instead of `<div onClick>` |
| `noNoninteractiveElementToInteractiveRole` | Use semantic elements (`<button>`, `<a>`) |
| `noLabelWithoutControl` | `htmlFor` + `id`, or DaisyUI `fieldset`/`legend` |

## MCP Tools

### Morph

**Fast Apply:** Use `edit_file` over `Edit`, `Update`, `Write`, and full file writes for **all** file edits and creation. It works with partial code snippets using `// ... existing code ...` markers — no need to read the full file first. This replaces the Read → Edit/Write workflow entirely.

**Known risks — silent failures:** `edit_file` can fail silently in two ways:
1. **Silent mutations:** It may alter code in `// ... existing code ...` regions — changing conditions, reordering logic, or dropping expressions you intended to leave untouched.
2. **Silent non-application:** When markers can't uniquely locate the insertion point, `edit_file` may report success with 0 changes added/removed/modified. The agent believes the edit was made when it wasn't.

**After every `edit_file` call, run `git diff` to verify the intended changes were applied.** A pre/post hook pair (`.claude/hooks/verify-edit-pre.sh` + `.claude/hooks/verify-edit.sh`) automatically blocks when `edit_file` produces no changes to an existing file, but you must still review the diff for silent mutations. Prefer small, targeted edits over full-file rewrites to minimize the blast radius.

**New directories:** `edit_file` can create new files in new directories — a `PreToolUse` hook (`.claude/hooks/auto-mkdir.sh`) automatically runs `mkdir -p` on the parent directory before each call.

**Warp Grep:** Use `warpgrep_codebase_search` for broad semantic searches at the start of codebase exploration. Best for: "Find the XYZ flow", "How does XYZ work?", "Where is XYZ handled?" Use regular `Grep` for pinpointing specific keywords or symbols.

### DaisyUI Blueprint

Use for UI component development with Tailwind CSS + DaisyUI.

**daisyUI-Snippets**: Fetch component code snippets. Use nested object syntax:
```json
{ "components": { "button": true, "card": true, "modal": true } }
```

Available categories: `component-examples`, `components`, `layouts`, `templates`, `themes`

**Figma-to-daisyUI**: Convert Figma designs to DaisyUI code. Workflow:
1. Call with Figma URL to get design structure
2. Analyze layout, components, colors, spacing
3. Call daisyUI-Snippets with required components
4. Build HTML using the retrieved snippets

### Playwright

Headless browser automation for UI validation. Available to all agents via `.mcp.json`.

**Use for**: Verifying UI behavior after building/modifying frontend components. Navigate to `http://localhost:5173` (dev) or `http://localhost:8042` (production), interact with elements, and confirm expected behavior.

**Key tools**: `browser_navigate`, `browser_click`, `browser_snapshot` (accessibility tree), `browser_type`

**Validation pattern**:
1. `browser_navigate` to the relevant page (e.g., `http://localhost:5173/issues`)
2. `browser_snapshot` to get the accessibility tree
3. Verify expected elements exist (buttons, text, badges, etc.)
4. `browser_click` / `browser_type` to test interactions
5. `browser_snapshot` again to verify the result

The accessibility tree approach means you identify elements by their role and name (e.g., "button 'Defer'") rather than CSS selectors — robust even as styles change.

**Verification after code changes:**
`bun --watch` restarts the server process when `src/` files change. After making a change:
1. Confirm compilation: `bun run typecheck`
2. Verify behavior: Use Playwright to navigate, snapshot, and interact
3. If the restart didn't fire: `launchctl stop dev.flux.daemon` and retry

For API changes, verify with `curl` or the Convex MCP `run` tool before declaring done.

### Convex

Backend-as-a-service for real-time data. Functions live in `convex/` directory.

**status**: Get deployment info. Always call first to get `deploymentSelector`.
```json
{ "projectDir": "/Users/jason/Projects/flux" }
```

**tables**: List all tables and their schemas. Requires `deploymentSelector`.

**functionSpec**: Get all function metadata (queries, mutations, actions).

**run**: Execute a Convex function:
```json
{
  "deploymentSelector": "<from status>",
  "functionName": "messages:list",
  "args": "{}"
}
```

**Convex workflow**:
1. Call `status` with projectDir to get deployment selector
2. Use `tables` to see database schema
3. Use `functionSpec` to see available functions
4. Use `run` to execute functions for testing/debugging

## Testing Strategy (MVP Phase)

**No automated tests until post-MVP.** During initial development:

- APIs are fluid and will change frequently
- Manual testing via `bunx convex run` is sufficient
- Integration via CLI validates end-to-end behavior
- Big refactors expected - tests would create drag

**When to add tests:**
- After F5 (React Frontend) is stable
- When orchestrator logic becomes complex
- When we need regression protection for critical paths

**Recommended approach when we do test:**
Use `convex-test` library with Vitest for proper Convex mocking:
```typescript
import { convexTest } from "convex-test";
const t = convexTest(schema);
await t.mutation(api.issues.claim, { issueId, assignee: "agent-1" });
```

**Never write:** Hand-rolled mock contexts that don't match Convex semantics.
