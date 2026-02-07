#!/bin/bash
# PreToolUse hook for mcp__morph-mcp__edit_file
# Morph edit_file fails with "name is not defined" when creating files
# in directories that don't exist. This hook ensures the parent directory
# exists before edit_file runs.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

PARENT_DIR=$(dirname "$FILE_PATH")

if [[ ! -d "$PARENT_DIR" ]]; then
  mkdir -p "$PARENT_DIR"
fi
