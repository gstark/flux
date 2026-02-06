# FLUX

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
- **Don't Be Lazy:** Taking short

## Development Guidelines

**Important**: `bun dev` and `convex dev` are always running. Agents should not start/kill or restart these servers. Expect code changes to reload.

Default to using Bun instead of Node.js.

Read the Bun API docs in `node_modules/bun-types/docs/**.mdx`

Do not add any new dependencies without asking first. This requires explicit permission from the user.

## MCP Tools

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
