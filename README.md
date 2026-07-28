# lokhand-log

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
| `lokhand-log` (this) | public | code only, zero PII, `data-example/` has fake demo data |
| `fitness-data` | private | your actual data; mounted into the app; pushes to your own local git remote |

## Quickstart (local debug, vanilla Ubuntu)

Requires [uv](https://docs.astral.sh/uv/) and Node 20+.

```bash
# 1. Make a data repo from the example
cp -r data-example ../fitness-data && cd ../fitness-data && git init && git add -A && git commit -m init && cd ../lokhand-log

# 2. Backend (FastAPI on :8000)
cd backend
LOKHAND_LOG_DATA_DIR=../../fitness-data uv run uvicorn app.main:app --reload

# 3. Frontend (Vite dev server on :5173, proxies /api to :8000)
cd frontend
npm install && npm run dev
```

Log in as `demo` / `demo` (change immediately; see `docs/DEPLOY.md`).

## MCP server (LLM advisor)

```bash
cd backend
LOKHAND_LOG_DATA_DIR=../../fitness-data uv run python mcp_server.py   # HTTP on :8765
```

Then add to Claude Desktop / Claude Code as a streamable-HTTP MCP server at
`http://<host>:8765/mcp`. See `docs/MCP.md`.

## Server deploy (Docker on Ubuntu VM)

```bash
DATA_DIR=/srv/fitness-data docker compose up -d --build
```

Caddy serves the built PWA and proxies `/api` + `/mcp` on one origin (`:8080`).
Details, git-remote backup, and Tailscale notes: `docs/DEPLOY.md`.

## Data files

Two hand-edited YAML files in the data repo drive the app. Full spec and the
JSONL log format live in `docs/DATA_FORMAT.md`; the keys in brief:

**`shared/exercises.yaml`** — a mapping of canonical exercise id → attributes:

```yaml
chest_press_db_incline:      # id: referenced by set entries and routines
  name: Chest Press, Incline, DB
  equipment: dumbbell        # optional: barbell | dumbbell | cable | machine | bodyweight
  primary: chest             # required: one muscle group from the fixed taxonomy
  secondary: [triceps, shoulders]   # optional list from the same taxonomy
  metric: reps               # optional (default reps): reps | duration | distance — how sets are counted
  bodyweight: false          # optional: true = load is body weight ± added/assist
  default_rest_s: 120        # optional (default 120): rest-timer length
  notes: Bench at 30°...      # optional: form cues, shown on the app's Info tab
```

`metric` picks the shape of a logged set: `reps` is weight×reps (the default); `duration`
is a held/timed set in seconds (planks, holds); `distance` is a set in miles (carries, runs).
Duration/distance exercises skip the weight field unless they're also `bodyweight: true`,
since bodyweight movements always track their own added/assist weight. Full field-by-field
detail, including how `bodyweight` and `metric` interact and drive PR scoring, is in
`docs/DATA_FORMAT.md`.

Taxonomy: `chest back shoulders biceps triceps quads hamstrings glutes calves core cardio`
(`cardio` is a pseudo-group for duration/distance activities with no real primary muscle).

**`shared/routines/*.yaml`** — one file per routine; each is a program with an
optional `name` and a list of `days`, and each day has `blocks`:

```yaml
name: Dumbbell Split         # optional; falls back to the filename
days:
  - name: Push Day           # you start a session from a day
    blocks:
      - exercises: [chest_press_db_incline]   # one exercise -> straight block
        rounds: 3                              # times through the exercises list
      - label: shoulder finisher              # >1 exercise -> superset/circuit
        rounds: 3
        exercises: [lateral_raise_db, pullup]
```

A block has three keys: `exercises` (the list, always), `rounds` (times through
the list, default 3), and optional `label`. One exercise is a straight block;
more than one is a superset/circuit. No `type` key; reps are logged as performed,
so blocks carry no target.

## Layout

```
backend/    FastAPI app, analytics, storage, git ops, MCP server
frontend/   Vite + React PWA (logging UI, rest timer, charts)
data-example/  Shape of a private data repo, with fake data
docs/       DATA_FORMAT.md, DEPLOY.md, MCP.md
```
