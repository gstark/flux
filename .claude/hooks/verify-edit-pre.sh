#!/bin/bash
# PreToolUse hook for mcp__morph-mcp__edit_file
# Snapshots file checksum before edit so verify-edit.sh can detect no-ops.
# See FLUX-199.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  # New file — nothing to snapshot
  exit 0
fi

# Derive a unique checksum file per target path to avoid races between
# concurrent edit_file calls (e.g. parallel agents on the same machine).
CHECKSUM_FILE="/tmp/flux-edit-checksum-$(echo "$FILE_PATH" | shasum | cut -d' ' -f1)"

# Use shasum (available on macOS and Linux) for consistent output format
shasum "$FILE_PATH" | cut -d' ' -f1 > "$CHECKSUM_FILE"

exit 0
