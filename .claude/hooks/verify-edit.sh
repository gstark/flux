#!/bin/bash
# PostToolUse hook for mcp__morph-mcp__edit_file
# Verifies that edit_file actually changed the file by comparing checksums
# taken before (verify-edit-pre.sh) and after the edit.
# Silent non-application (0 changes) is as dangerous as silent mutation —
# the agent believes the edit was made when it wasn't. See FLUX-199.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

CHECKSUM_FILE="/tmp/flux-edit-checksum"

if [[ ! -f "$CHECKSUM_FILE" ]]; then
  # No pre-snapshot — file was new, nothing to compare
  exit 0
fi

PRE_CHECKSUM=$(cat "$CHECKSUM_FILE")
rm -f "$CHECKSUM_FILE"

POST_CHECKSUM=$(shasum "$FILE_PATH" | cut -d' ' -f1)

if [[ "$PRE_CHECKSUM" == "$POST_CHECKSUM" ]]; then
  jq -n '{"decision":"block","reason":"edit_file produced no changes to this file. The edit was silently not applied — verify your // ... existing code ... markers can uniquely locate the insertion point, then retry."}'
fi

exit 0
