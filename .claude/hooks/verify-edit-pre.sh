#!/bin/bash
# PreToolUse hook for mcp__morph-mcp__edit_file
# Snapshots file checksum before edit so verify-edit.sh can detect no-ops.
# See FLUX-199.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

CHECKSUM_FILE="/tmp/flux-edit-checksum"

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  # New file — nothing to snapshot
  rm -f "$CHECKSUM_FILE" 2>/dev/null
  exit 0
fi

# Use shasum (available on macOS and Linux) for consistent output format
shasum "$FILE_PATH" | cut -d' ' -f1 > "$CHECKSUM_FILE"

exit 0
