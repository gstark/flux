# Planner

A periodic, project-scoped agent session that surveys the backlog and
maintains it. Not tied to any single issue — it operates at the
project level.

## What It Does (per run)

1. **Survey** — read open/deferred issues, recent session outcomes,
   project health
2. **Reprioritize** — adjust priorities based on current context,
   defer blocked work, bump unblocking work
3. **Seed** — when the queue is thin, read project guidance + design
   docs and decompose goals into concrete issues
4. **Prune** — close obsolete/duplicate issues, flag repeated failures

## Activation

Two gates, both required:

1. **Project `enabled` in Convex** — the master switch. If the project
   is disabled, the daemon doesn't run a `ProjectRunner` at all, so
   no planner.
2. **`[planner]` section in `.flux`** — opt-in per repo. No section =
   no planner.

## `.flux` File Format

The `.flux` file evolves from a bare project ID to a structured TOML
config. Bare IDs continue to work (no planner).

```toml
project = "k1782262nvqjfr8y0w6rj72heh84j2vf"

[planner]
schedule = "0 */2 * * *"
agenda = """
North star: ooker is a native WoW engine built in Zig.
Prioritize ook engine work and dooker probes over tooling.
Wicket knowledge gaps block everything — seed RE tasks when
the queue is thin. Read PRODUCT.md and FACTORY.md for the backlog.
"""
```

- `schedule` — cron expression, interpreted in UTC by Bun.cron
- `agenda` — the planner's north star. Read fresh each run so edits
  take effect immediately. The planner itself can update this.

The agenda is repo-scoped guidance — what the project needs, what to
prioritize, where to find the backlog. It belongs next to the code,
not in a database.

## Trigger

`Bun.cron()` in-process, registered by `ProjectRunner` when the
`[planner]` section is present. Bun's no-overlap guarantee means a
slow planner session won't stack — the next fire is scheduled after
the handler settles.

On config change (`.flux` file modified), stop the old cron job and
re-register with the new schedule.

## Session Model

- **New session type**: `SessionType.Planner` — not a phase on an
  issue session
- **No issue association** — planner sessions belong to the project
- **Disposition**: structured output — `done`, `noop` (nothing to
  change), `fault`
- **Spawned via `provider.spawn()`** — fresh session each run

## Prompt

The planner prompt includes:

- The **agenda** from `.flux`
- **Queue stats** — open count, in-progress, deferred, recently
  closed, high-failure issues
- The **flux CLI reference** — so it can create/update/close/defer
  issues
- **Constraints** — no code writing, backlog management only

Custom planner prompts follow the same pattern as work/retro/review:
`plannerPrompt` field on the Convex projects table, with `{{AGENDA}}`
and `{{QUEUE_STATS}}` placeholders.

## CLI Surface

Read-only views and manual trigger — config lives in `.flux`, not CLI:

```bash
flux planner status          # Last run, next fire, agenda preview
flux planner run             # Trigger immediate run (bypasses cron)
```

## Files to Touch

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `SessionType.Planner`, `plannerPrompt?` on projects |
| `convex/projects.ts` | Mutation for `plannerPrompt` |
| `src/server/orchestrator/index.ts` | `ProjectRunner` cron registration, planner session lifecycle |
| `src/server/orchestrator/agents/prompts.ts` | `buildPlannerPrompt()` with agenda + queue stats |
| `src/cli/tools.ts` | Parse evolved `.flux` format (TOML with `[planner]`) |
| `src/cli/planner.ts` | New `planner` command group (status, run) |
| `.flux` reader | Backwards-compat: bare ID still works, TOML is new format |

## Migration

- Existing `.flux` files with just a bare ID continue to work —
  planner disabled by default
- Projects opt in by adding `[planner]` section to `.flux`
