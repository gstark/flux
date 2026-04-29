#!/usr/bin/env bash
# Start a standalone Vite dev server from this checkout for UI verification.
# Proxies API requests to the running Flux daemon so the full app works.
#
# Usage:
#   scripts/dev-preview.sh          # start on default port 5555
#   scripts/dev-preview.sh 5556     # start on custom port
#   scripts/dev-preview.sh stop     # kill a running preview server
#
# The preview URL will be: http://localhost:<port>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_DIR/.dev-preview.pid"

# Read daemon port from persisted config
DAEMON_PORT=$(cat ~/.flux/daemon.json 2>/dev/null | grep '"fluxPort"' | tr -dc '0-9')
DAEMON_PORT="${DAEMON_PORT:-9000}"

stop_preview() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo "Stopped dev-preview (PID $PID)"
    else
      echo "dev-preview not running (stale PID $PID)"
    fi
    rm -f "$PID_FILE"
  else
    echo "No dev-preview PID file found"
  fi
}

if [ "${1:-}" = "stop" ]; then
  stop_preview
  exit 0
fi

PREVIEW_PORT="${1:-5555}"

# Kill any existing preview first
stop_preview 2>/dev/null || true

echo "Starting dev-preview from: $PROJECT_DIR"
echo "Preview URL:  http://localhost:$PREVIEW_PORT"
echo "Daemon proxy: http://localhost:$DAEMON_PORT"
echo ""

cd "$PROJECT_DIR"
FLUX_VITE_PORT="$PREVIEW_PORT" FLUX_PORT="$DAEMON_PORT" bunx vite &
VITE_PID=$!
echo "$VITE_PID" > "$PID_FILE"

echo "Vite PID: $VITE_PID (saved to .dev-preview.pid)"
echo "Stop with: scripts/dev-preview.sh stop"
