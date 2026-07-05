# fitness-app

Self-hosted fitness log + health metrics tracker, designed so an LLM can act as a
fully-informed fitness advisor over your entire history.

**Design principles**

- **Plain-text data.** Every set, cardio session, and body metric is one JSON line in a
  monthly `.jsonl` file inside a *separate private git repo*. Human-readable, greppable,
  diffable, LLM-friendly. No database.
- **Auditable core.** All data handling, validation, and analytics live in the Python
  backend (`backend/app/`). The React frontend never touches disk — it renders JSON from
  the API. Reading `backend/` covers 100% of the data path.
- **Set-as-record.** Each resistance set is an independent entry with a timestamp, so
  supersets/circuits are just consecutive entries, and rest time falls out of timestamp
  deltas for free.
- **LLM access via MCP.** The backend ships an MCP server exposing the same analytics the
  charts use (`get_exercise_history`, `get_volume_trend`, `get_prs`, ...). Claude
  connects over LAN/Tailscale. The data repo is also directly readable by Claude Code.

## Repos

| Repo | Visibility | Contents |
|---|---|---|
| `fitness-app` (this) | public | code only, zero PII, `data-example/` has fake demo data |
| `fitness-data` | private | your actual data; mounted into the app; pushes to your own local git remote |

## Quickstart (local debug, vanilla Ubuntu)

Requires [uv](https://docs.astral.sh/uv/) and Node 20+.

```bash
# 1. Make a data repo from the example
cp -r data-example ../fitness-data && cd ../fitness-data && git init && git add -A && git commit -m init && cd ../fitness-app

# 2. Backend (FastAPI on :8000)
cd backend
FITNESS_DATA_DIR=../../fitness-data uv run uvicorn app.main:app --reload

# 3. Frontend (Vite dev server on :5173, proxies /api to :8000)
cd frontend
npm install && npm run dev
```

Log in as `demo` / `demo` (change immediately; see `docs/DEPLOY.md`).

## MCP server (LLM advisor)

```bash
cd backend
FITNESS_DATA_DIR=../../fitness-data uv run python mcp_server.py   # HTTP on :8765
```

Then add to Claude Desktop / Claude Code as a streamable-HTTP MCP server at
`http://<host>:8765/mcp`. See `docs/MCP.md`.

## Server deploy (Docker on Ubuntu VM)

```bash
DATA_DIR=/srv/fitness-data docker compose up -d --build
```

Caddy serves the built PWA and proxies `/api` + `/mcp` on one origin (`:8080`).
Details, git-remote backup, and Tailscale notes: `docs/DEPLOY.md`.

## Layout

```
backend/    FastAPI app, analytics, storage, git ops, MCP server
frontend/   Vite + React PWA (logging UI, rest timer, charts)
data-example/  Shape of a private data repo, with fake data
docs/       DATA_FORMAT.md, DEPLOY.md, MCP.md
```
