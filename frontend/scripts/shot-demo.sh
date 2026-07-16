#!/usr/bin/env bash
# Screenshot the app against a THROWAWAY backend, so captures never touch your
# real fitness-data. Spins up:
#   - a backend on :8100 over a temp copy of data-example (not a git repo, so
#     every git_commit no-ops — zero commits, zero writes to your data)
#   - a demo Vite dev server on :5273 proxying /api to :8100
# then runs shot.mjs (with SHOT_LOG, since the data is disposable) and cleans up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="$(cd "$FRONTEND/.." && pwd)"
API_PORT=8100
WEB_PORT=5273
TMP="$(mktemp -d)"

cleanup() {
  pkill -f "uvicorn app.main:app --port $API_PORT" 2>/dev/null || true
  pkill -f "vite --port $WEB_PORT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

cp -r "$APP/data-example" "$TMP/data"

echo "starting throwaway backend on :$API_PORT (data: $TMP/data)"
( cd "$APP/backend" && VIRTUAL_ENV= LOKHAND_LOG_DATA_DIR="$TMP/data" \
    uv run uvicorn app.main:app --port "$API_PORT" --log-level warning ) &

echo "starting demo frontend on :$WEB_PORT"
( cd "$FRONTEND" && VITE_API_TARGET="http://localhost:$API_PORT" \
    npx vite --port "$WEB_PORT" --strictPort --clearScreen false >/dev/null 2>&1 ) &

wait_for() {  # url, name
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null -m 2 "$1"; then echo "  $2 ready"; return 0; fi
    sleep 0.5
  done
  echo "  timed out waiting for $2 ($1)" >&2; exit 1
}
wait_for "http://localhost:$API_PORT/api/me" "backend"
wait_for "http://localhost:$WEB_PORT/" "frontend"

BASE="http://localhost:$WEB_PORT" OUT="$FRONTEND/shots" SHOT_LOG=1 \
  node "$SCRIPT_DIR/shot.mjs"
