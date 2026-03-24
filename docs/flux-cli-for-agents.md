## Flux Issue Tracker

This project uses Flux for issue tracking and autonomous agent orchestration. The `flux` CLI is available globally.

### Quick Reference

```bash
# List open issues
flux issues list --status open

# Get issue details
flux issues get FLUX-42

# Search issues
flux issues search "login bug"

# Create an issue
flux issues create --title "Fix the thing" --priority high

# Close an issue
flux issues close FLUX-42 --closeType completed --reason "Fixed in abc123"

# Defer/undefer
flux issues defer FLUX-42 --note "Blocked on upstream"
flux issues undefer FLUX-42 --note "Upstream resolved"

# View orchestrator status
flux orchestrator status

# Trigger the orchestrator to work an issue
flux orchestrator run FLUX-42

# View session history
flux sessions list --limit 5
flux sessions show <sessionId>
```

### For Agents

When working on an issue assigned by Flux:
- Your issue ID is in the `FLUX_ISSUE_ID` environment variable
- Commit with the issue ID prefix: `git add <files> && git commit -m "FLUX-XX: description"`
- Use `flux comments create FLUX-XX --content "status update"` to leave progress notes
- Use `flux issues create --title "Follow-up task"` for discovered work
