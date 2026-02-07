#!/usr/bin/env bash
# lint-schema-constants.sh — Detect raw string literals that should use schema constants.
#
# Schema constants are defined in convex/schema.ts (IssueStatus, IssuePriority,
# CommentAuthor, CloseType, Disposition, SessionStatus, SessionPhase, etc.).
# Using raw strings like `author: "flux"` instead of `CommentAuthor.Flux` causes
# drift bugs — if a value changes, the raw string won't break at compile time.
#
# This script catches the most common patterns in src/ and convex/ files.
# It is meant to be run as a CI check or pre-commit hook.
#
# Usage:
#   ./scripts/lint-schema-constants.sh    # exits 0 if clean, 1 if violations found

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Files to scan ────────────────────────────────────────────────────
# Scan src/ and convex/ but exclude:
#   - convex/schema.ts (the source of truth for these constants)
#   - prompts.ts (contains human-readable prompt text with these words in prose)

SCAN_DIRS=("$REPO_ROOT/src" "$REPO_ROOT/convex")

# Common rg flags used by all checks
RG_BASE=(
  --no-heading --line-number --with-filename
  --type-add "tsx:*.tsx"
  --type ts --type tsx
  --glob "!convex/schema.ts"
  --glob "!**/prompts.ts"
)

# ── Run checks ───────────────────────────────────────────────────────

violations=0

run_check() {
  local label="$1"
  local constant="$2"
  local pattern="$3"

  local results
  results=$(rg "${RG_BASE[@]}" "$pattern" "${SCAN_DIRS[@]}" 2>/dev/null || true)

  if [[ -n "$results" ]]; then
    echo ""
    echo "✗ $label — use $constant instead:"
    echo "$results" | while IFS= read -r line; do
      echo "  $line"
    done
    violations=$((violations + $(echo "$results" | wc -l)))
  fi
}

run_check_pcre() {
  local label="$1"
  local constant="$2"
  local pattern="$3"

  local results
  results=$(rg -P "${RG_BASE[@]}" "$pattern" "${SCAN_DIRS[@]}" 2>/dev/null || true)

  if [[ -n "$results" ]]; then
    echo ""
    echo "✗ $label — use $constant instead:"
    echo "$results" | while IFS= read -r line; do
      echo "  $line"
    done
    violations=$((violations + $(echo "$results" | wc -l)))
  fi
}

echo "Checking for raw string literals that should use schema constants..."

# CloseType values: completed, noop, duplicate, wontfix
# Constant: CloseType.Completed, CloseType.Noop, etc.
run_check \
  "Raw CloseType string" \
  "CloseType.*" \
  'closeType:\s*"(completed|noop|duplicate|wontfix)"'

# CommentAuthor values: user, agent, flux
# Constant: CommentAuthor.User, CommentAuthor.Agent, CommentAuthor.Flux
run_check \
  "Raw CommentAuthor string" \
  "CommentAuthor.*" \
  'author:\s*"(user|agent|flux)"'

# IssueStatus comparisons: .status === "open", .status !== "deferred", etc.
# Constant: IssueStatus.Open, IssueStatus.Closed, etc.
run_check \
  "Raw IssueStatus comparison" \
  "IssueStatus.*" \
  '\.status\s*(===|!==)\s*"(open|closed|in_progress|deferred|stuck)"'

# IssueStatus assignments: status: "open", status: "closed", etc.
# Uses PCRE2 lookbehind to avoid matching inside words like "sessionStatus"
run_check_pcre \
  "Raw IssueStatus assignment" \
  "IssueStatus.*" \
  '(?<!\w)status:\s*"(open|closed|in_progress|deferred|stuck)"'

# SessionStatus comparisons: .status === "running", etc.
# Constant: SessionStatus.Running, SessionStatus.Completed, SessionStatus.Failed
run_check \
  "Raw SessionStatus comparison" \
  "SessionStatus.*" \
  '\.status\s*(===|!==)\s*"(running|completed|failed)"'

# Disposition assignments: disposition: "done", etc.
# Constant: Disposition.Done, Disposition.Noop, Disposition.Fault
run_check \
  "Raw Disposition assignment" \
  "Disposition.*" \
  'disposition:\s*"(done|noop|fault)"'

# VALID_DISPOSITIONS raw set — should derive from Disposition constant
run_check \
  "Raw Disposition set literal" \
  "Object.values(Disposition)" \
  'new Set.*\["(done|noop|fault)"'

# SessionEventDirection: direction: "input" or direction: "output"
# Constant: SessionEventDirection.Input, SessionEventDirection.Output
run_check \
  "Raw SessionEventDirection string" \
  "SessionEventDirection.*" \
  'direction:\s*"(input|output)"'

# SessionPhase: hand-written type literal instead of importing from schema
# Constant: import { SessionPhase } from "convex/schema"
run_check \
  "Raw SessionPhase type literal" \
  "SessionPhase constant from schema" \
  'type SessionPhase\s*='

# ── Result ───────────────────────────────────────────────────────────

echo ""
if [[ $violations -gt 0 ]]; then
  echo "Found $violations violation(s). Use the exported constants from convex/schema.ts."
  exit 1
else
  echo "✓ No raw string literal violations found."
  exit 0
fi
