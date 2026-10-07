---
name: run-lokhand-log
description: Build, run, and drive lokhand-log (FastAPI backend + Vite/React fitness-log PWA + MCP server). Use when asked to start or run the app, log in and click through the UI, take a screenshot of a screen, smoke-test the API or MCP tools, run backend tests, or check a frontend/backend change in the real running app.
---

lokhand-log is a FastAPI backend over JSONL files in a data dir, plus a Vite/React PWA
and a read-only MCP server. Agents drive it through two scripts in this directory:
`stack.sh` starts a **throwaway** backend and Vite server over a temp copy of
`data-example/`, and `driver.mjs` keeps a headless Chromium alive between calls. Each
`driver.mjs run` continues in the same tab, with the same login and the same
in-progress workout.

All paths below are relative to the `lokhand-log/` repo root.

## Prerequisites

Ubuntu 24.04, `uv`, Node 20+ (verified with Node 24), and `curl`/`jq`. Playwright
1.61.1 is a frontend devDependency. Its browser builds live in `~/.cache/ms-playwright`.

Chromium needs system libs that this host lacks, and `sudo` asks for a password.
Unpack them without root, once per machine (driver.mjs picks them up automatically):

```bash
.claude/skills/run-lokhand-log/chrome-libs.sh    # -> "ok: ... resolves all libs"
```

## Setup / Build

```bash
(cd backend && uv run pytest -q)        # also creates backend/.venv
(cd frontend && npm ls --depth=0)       # node_modules is already installed here: vite, playwright, react...
(cd frontend && npx vite build --outDir /tmp/lokhand-dist --emptyOutDir)   # optional prod build check, ~4s
```

On this host, `npm install` **fails with a permissions error**: `frontend/package-lock.json`
is owned by `root`. You don't need it while `npm ls` is clean. On a fresh clone, run
`npm install` normally.

## Run (agent path)

```bash
S=.claude/skills/run-lokhand-log
$S/stack.sh up                 # backend :8110, Vite :5283 (proxies /api), data in /tmp/lokhand-log-run/data
node $S/driver.mjs open        # headless Chromium, 360x800 (Pixel 8a), CDP :9333
node $S/driver.mjs run <<'EOF'
await login()                              // demo/demo
await tab('session')                       // ☰ drawer: home session routines library history stats body
await page.getByText('Start empty workout').click()
await page.locator('.expicker-trigger').click()
await page.locator('.expicker input').fill('Chest Press, Incline, DB')
await page.locator('.expicker-row', { hasText: 'Chest Press, Incline, DB' }).click()
await pause(900)                           // weight/reps/rpe autofill from history
await page.getByRole('button', { name: 'Log set', exact: true }).click()
await pause(700)
await ss('resting')                        // -> /tmp/lokhand-log-run/shots/resting.png
return (await text()).slice(0, 300)
EOF
tail -n 1 /tmp/lokhand-log-run/data/users/demo/workouts/$(date +%Y-%m).jsonl   # the set you just logged
node $S/driver.mjs close
$S/stack.sh down
```

| command | what it does |
|---|---|
| `stack.sh up` / `status` / `logs` / `down` | start (idempotent) / pids + health / tail logs / kill both process groups and delete the temp data |
| `GIT=1 stack.sh up` | `git init` the temp data, so edit, delete, and session-end commits actually run |
| `driver.mjs open [url]` | launch the browser if needed; goto url (default `$BASE`, http://127.0.0.1:5283) |
| `driver.mjs run < js` | run JS with `page, BASE, login(u,p), tab(name), ss(name), pause(ms), text()` in scope; the return value is printed as JSON |
| `driver.mjs ss [name]` / `url` | screenshot / print URL and visible text |
| `driver.mjs close` | kill the browser |

Page `console.error` and `pageerror` events print to stderr after each call. The two
`401 (Unauthorized)` lines on `open` before login are expected (`/api/me`).
Env overrides: `API_PORT WEB_PORT RUN_DIR` (stack), `BASE CDP_PORT OUT DSF CHROME` (driver).

### API without a browser (curl through the Vite proxy)

```bash
B=http://127.0.0.1:5283/api; J=$(mktemp)
curl -s -c $J -b $J -X POST $B/login -H 'content-type: application/json' -d '{"username":"demo","password":"demo"}'
SID=$(curl -s -b $J -X POST $B/sessions/start -H 'content-type: application/json' -d '{"name":"curl smoke"}' | jq -r .session_id)
curl -s -b $J -X POST $B/sets -H 'content-type: application/json' -d "{\"session_id\":\"$SID\",\"exercise_id\":\"chest_press_db_incline\",\"weight_lb\":45,\"reps\":10}"
curl -s -b $J "$B/analytics/exercises/chest_press_db_incline/progression" | jq '.sessions | length'
curl -s -b $J -X POST $B/sessions/$SID/end
```

Routes are in `backend/app/api.py`, all under `/api`. Every route except `/api/health`
needs the login cookie.

### Direct invocation (analytics/storage changes)

```bash
(cd backend && LOKHAND_LOG_DATA_DIR=/tmp/lokhand-log-run/data uv run python -c "
from app import analytics
print(analytics.exercise_progression('demo', 'chest_press_db_incline')['sessions'][-1])
print(analytics.list_sessions('demo', limit=3))")
```

`config.DATA_DIR` is resolved **at import time**, so set the env var before Python
starts. The tests override `config.DATA_DIR` directly for the same reason.

### MCP server

`mcp_server.py` hardcodes port **8765** (read-only, pinned to `LOKHAND_LOG_MCP_USER`,
default `demo`). Stop it by port, not with `kill -- -$!` (see Gotchas):

```bash
(cd backend && LOKHAND_LOG_DATA_DIR=/tmp/lokhand-log-run/data uv run python mcp_server.py > /tmp/lokhand-log-run/mcp.log 2>&1 &)
timeout 30 bash -c 'until curl -s -o /dev/null 127.0.0.1:8765/mcp; do sleep 0.25; done'
(cd backend && uv run python -c "
import asyncio; from fastmcp import Client
async def m():
    async with Client('http://127.0.0.1:8765/mcp') as c:
        print([t.name for t in await c.list_tools()]); print((await c.call_tool('get_prs', {})).data[:1])
asyncio.run(m())")
kill $(ss -ltnp 'sport = :8765' | grep -o 'pid=[0-9]*' | cut -d= -f2)
```

## Run (human path)

The README's `uv run uvicorn ... --reload` + `npm run dev` uses :8000/:5173, which
**this host already uses for other apps** (see Gotchas). Use `stack.sh up` and open
the printed `BASE` instead.

## Test

```bash
cd backend && uv run pytest -q     # 13 passed, 1 StarletteDeprecationWarning, ~5s
```

The frontend has no test suite. `driver.mjs` is how you check UI changes.

## Gotchas

- **Never point anything at the real data.** The user's live instance is the Docker
  Compose stack on **:8080** (caddy, backend, and mcp over their private
  fitness-data repo). **:8000 and :5173 belong to an unrelated `cal-tracker` app.**
  README defaults would collide or talk to the wrong backend. The stack defaults to
  8110/5283 for this reason.
- **Orphaned :8100 backend.** A `uvicorn --port 8100` left over from an old
  `frontend/scripts/shot-demo.sh` run (running since Aug 5) still answers
  `/api/health` 200, but its data dir was deleted. `shot-demo.sh` hardcodes :8100 and
  only waits for *a* response, so it would screenshot that zombie. `stack.sh` refuses
  a busy port instead of waiting on it.
- **The data dir isn't a git repo by default.** `storage.git_commit` returns
  `"not a git repo; skipped"`, so edit and delete commit paths silently no-op. Use
  `GIT=1 stack.sh up` when a change touches commits.
- **`cd x && setsid cmd &` records the wrong pid.** The `&` backgrounds the whole
  list, so `$!` is a short-lived subshell and `kill -- -$!` misses the server (this is
  how servers get orphaned). In an interactive job-control shell, `setsid cmd &` also
  forks, so `$!` is again not the group leader. `stack.sh` backgrounds `setsid` as a
  plain command from a script. For anything else, kill by port with `ss -ltnp`.
- **`pgrep -f` / `pkill -f` match your own shell.** Your command line contains the
  pattern, so `pkill -f -- '--remote-debugging-port=9333'` from a Bash tool call kills
  that call (exit 144), and `pgrep -f` reports phantom survivors. Check ports with
  `ss -ltn` instead.
- **Driver state is the browser's state.** `localStorage['ironlog.active']` keeps an
  in-progress workout across `run` calls, which is what makes multi-step flows work.
  It also survives a stack restart. A workout left over from an older temp data dir
  resumes as a ghost session, and "Start empty workout" never appears (`locator.click:
  Timeout 30000ms exceeded`). `open` wipes the profile whenever it launches a new
  browser, so after `stack.sh down && up`, run `driver.mjs close && driver.mjs open`.
- **`text()` includes the closed drawer's labels** (HOME SESSION ... BODY), because the
  drawer stays in the DOM. Scope with `page.locator(...)` when asserting.
- **Selectors:** buttons render uppercase via CSS, but accessible names are the
  source text (`'Log set'`, `'Start empty workout'`, `'Finish workout'`). Drawer
  buttons are lowercase tab keys. The UI uses pointer events only (plan-row drag), so
  mouse input is enough and no touch emulation is needed.

## Troubleshooting

- **`chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0`**
  (driver says `chromium did not open CDP on :9333`, with a tail of
  `/tmp/lokhand-log-run/chrome.log`): run `chrome-libs.sh`. `ldd` on the binary lists
  anything still `not found`. `libXrender`/`libXi` show up only after the first batch
  is unpacked, and the script includes them.
- **`driver.mjs` hangs after printing its result:** the CDP websocket keeps Node
  alive. The CLI must end in `process.exit()`; don't call `browser.close()` either,
  because that tears down the shared browser.
- **`port 8110 is already in use`:** a previous stack whose pid files were lost. Find
  it with `ss -ltnp 'sport = :8110'`, then kill its process group
  (`kill -- -$(ps -o pgid= -p <pid>)`), or set `API_PORT`/`WEB_PORT`.
- **Docker fallback for the browser:** `mcr.microsoft.com/playwright:v1.61.1-jammy` is
  already pulled on this host, if the local-libs route ever breaks (not needed so far).
