#!/usr/bin/env bash
# Throwaway lokhand-log stack for agents: FastAPI backend + Vite dev server over a
# TEMP COPY of data-example. Never touches a real fitness-data repo.
#
#   stack.sh up        # start (idempotent); prints URLs + data dir
#   stack.sh status    # pids + health
#   stack.sh logs      # tail both logs
#   stack.sh down      # kill both process groups, delete temp data
#
# Env: API_PORT (8110) WEB_PORT (5283) RUN_DIR (${TMPDIR:-/tmp}/lokhand-log-run)
#      GIT=1  -> git-init the temp data so commit paths (edit/delete/session end) run
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$SKILL_DIR/../../.." && pwd)"
API_PORT="${API_PORT:-8110}"
WEB_PORT="${WEB_PORT:-5283}"
RUN_DIR="${RUN_DIR:-${TMPDIR:-/tmp}/lokhand-log-run}"

alive() { [ -f "$RUN_DIR/$1.pid" ] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null; }
listening() { curl -s -o /dev/null -m 1 "http://127.0.0.1:$1/"; }

wait_for() {  # url name logfile
  for _ in $(seq 1 80); do
    curl -sf -o /dev/null -m 1 "$1" && { echo "  $2 ready: $1"; return 0; }
    sleep 0.25
  done
  echo "  timed out waiting for $2 ($1); last log lines:" >&2
  tail -20 "$3" >&2; exit 1
}

up() {
  if alive backend && alive web; then echo "already up"; status; return; fi
  down >/dev/null 2>&1 || true
  # Refuse to reuse a port: a stale server there would answer health checks
  # while serving the wrong (or deleted) data dir.
  for p in "$API_PORT" "$WEB_PORT"; do
    if listening "$p"; then
      echo "port $p is already in use (ss -ltnp 'sport = :$p'); set API_PORT/WEB_PORT" >&2; exit 1
    fi
  done

  mkdir -p "$RUN_DIR"
  cp -r "$APP/data-example" "$RUN_DIR/data"
  if [ "${GIT:-}" = 1 ]; then
    git -C "$RUN_DIR/data" init -q
    git -C "$RUN_DIR/data" -c user.name=demo -c user.email=demo@localhost add -A
    git -C "$RUN_DIR/data" -c user.name=demo -c user.email=demo@localhost commit -qm init
  fi

  # setsid -> each server leads its own process group, so `down` kills
  # uv + uvicorn (and npx + vite) together instead of orphaning the child.
  # `cd` must NOT be in the backgrounded list (`cd x && setsid ... &`): then $! is a
  # short-lived subshell, the pid file is garbage, and `down` orphans the servers.
  cd "$APP/backend"
  VIRTUAL_ENV= LOKHAND_LOG_DATA_DIR="$RUN_DIR/data" \
    setsid uv run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" \
    >"$RUN_DIR/backend.log" 2>&1 </dev/null &
  echo $! >"$RUN_DIR/backend.pid"
  cd "$APP/frontend"
  VITE_API_TARGET="http://127.0.0.1:$API_PORT" \
    setsid npx vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort --clearScreen false \
    >"$RUN_DIR/web.log" 2>&1 </dev/null &
  echo $! >"$RUN_DIR/web.pid"
  cd "$APP"

  wait_for "http://127.0.0.1:$API_PORT/api/health" backend "$RUN_DIR/backend.log"
  wait_for "http://127.0.0.1:$WEB_PORT/" frontend "$RUN_DIR/web.log"
  echo "data: $RUN_DIR/data   logs: $RUN_DIR/{backend,web}.log"
  echo "BASE=http://127.0.0.1:$WEB_PORT  (login demo/demo)"
}

down() {
  for s in web backend; do
    if alive "$s"; then kill -- "-$(cat "$RUN_DIR/$s.pid")" 2>/dev/null || true; fi
  done
  sleep 0.5
  rm -rf "$RUN_DIR/data" "$RUN_DIR/backend.pid" "$RUN_DIR/web.pid"  # chrome.pid belongs to driver.mjs
  echo "down"
}

status() {
  for s in backend web; do
    if alive "$s"; then echo "$s: pid $(cat "$RUN_DIR/$s.pid")"; else echo "$s: not running"; fi
  done
  curl -s -m 1 "http://127.0.0.1:$API_PORT/api/health" && echo " <- :$API_PORT/api/health" || true
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  logs) tail -n 40 "$RUN_DIR/backend.log" "$RUN_DIR/web.log" ;;
  *) echo "usage: $0 up|status|logs|down" >&2; exit 2 ;;
esac
