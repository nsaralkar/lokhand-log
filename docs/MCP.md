# LLM advisor via MCP

The MCP server exposes the same analytics the charts use, plus raw history —
so the advisor and the UI can never disagree about the numbers.

## Connect

Claude Desktop / Claude.ai custom connector / Claude Code, streamable HTTP:

```
http://<vm-or-tailnet-host>:8080/mcp     (via Caddy)
http://<host>:8765/mcp                   (direct, local debug)
```

Claude Code: `claude mcp add --transport http fitness http://<host>:8080/mcp`

## Tools

| Tool | Use |
|---|---|
| `list_exercises` | canonical ids + muscle groups (query key for everything else) |
| `get_recent_sessions` / `get_session_detail` | what happened lately, incl. rest deltas |
| `get_exercise_history` | per-session top set, e1RM, full sets w/ RPE + notes |
| `get_volume_trend` / `get_muscle_group_volume` | tonnage over time, balance |
| `get_prs` | best e1RM set per exercise |
| `get_cardio_trends`, `get_body_metrics` | cardio + weight/dimensions series |
| `get_templates` | current programming |
| `get_raw_entries` | escape hatch: raw JSONL between dates |

All loads are canonical kg — tell Claude your display preference or let it read
it from context.

## Prompt starting point

> You are my strength & conditioning advisor. Use the fitness MCP tools before
> answering anything about my training. When I ask what to do for an exercise,
> pull `get_exercise_history`, consider RPE and notes, and recommend a concrete
> load/reps for today with one-line reasoning. Flag muscle groups whose weekly
> volume has dropped >30% vs my 8-week norm. I use imperial units.

## Alternative: no server at all

The data repo is plain text. Point Claude Code at `/srv/fitness-data` and it can
grep/analyze directly — useful for one-off deep dives (e.g. "correlate my
pressing e1RM with body weight over 12 months").
