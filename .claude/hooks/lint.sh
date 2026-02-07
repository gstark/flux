#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [[ "$FILE_PATH" =~ \.tsx?$ ]]; then
  cd "$(echo "$INPUT" | jq -r '.cwd')"
  bun run check 2>&1 | tail -5
fi
exit 0
