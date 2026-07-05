"""MCP server: the LLM advisor's window into your data.

Exposes the SAME analytics functions the charts use, plus raw-history access.
Run over streamable HTTP for LAN/Tailscale use:

    FITNESS_DATA_DIR=../../fitness-data FITNESS_MCP_USER=rachna uv run python mcp_server.py

Claude Desktop / Claude Code config: http://<host>:8765/mcp

Scope note: the MCP server is read-only and pinned to one user via
FITNESS_MCP_USER — it does not use the web app's auth. Run one instance per
user if the family wants separate advisors.
"""
from __future__ import annotations

import os

from fastmcp import FastMCP

from app import analytics, config
from app.library import load_exercises, load_templates
from app.storage import iter_entries

USER = os.environ.get("FITNESS_MCP_USER", "demo")

mcp = FastMCP(
    "fitness-data",
    instructions=(
        "Fitness history for one athlete. Loads are canonical kg; convert for the "
        "user's preference when presenting. Tonnage = load x reps, work sets only. "
        "Use exercise ids from list_exercises when querying progression."
    ),
)


@mcp.tool()
def list_exercises() -> list[dict]:
    """Canonical exercise library: ids, names, equipment, muscle groups."""
    return [e.model_dump() for e in load_exercises().values()]


@mcp.tool()
def get_recent_sessions(limit: int = 10) -> list[dict]:
    """Most recent workout sessions with set counts."""
    return analytics.list_sessions(USER, limit)


@mcp.tool()
def get_session_detail(session_id: str) -> dict:
    """Full ordered entries for one session, including per-entry rest deltas,
    duration, and tonnage."""
    return analytics.session_summary(USER, session_id)


@mcp.tool()
def get_exercise_history(exercise_id: str, limit_sessions: int = 20) -> dict:
    """Per-session top set, est. 1RM (Epley), and full set detail (incl. RPE and
    notes) for one exercise. The primary input for progression advice."""
    return analytics.exercise_progression(USER, exercise_id, limit_sessions)


@mcp.tool()
def get_volume_trend(bucket: str = "week", muscle: str | None = None) -> list[dict]:
    """Tonnage over time (kg), weekly or per-day, optionally filtered by
    primary muscle group."""
    return analytics.volume_over_time(USER, bucket, muscle)


@mcp.tool()
def get_muscle_group_volume(weeks: int = 8) -> list[dict]:
    """Weekly tonnage split by primary muscle group — for balance analysis."""
    return analytics.muscle_group_volume(USER, weeks)


@mcp.tool()
def get_prs() -> list[dict]:
    """Best estimated-1RM set per exercise."""
    return analytics.prs(USER)


@mcp.tool()
def get_cardio_trends(activity: str | None = None) -> list[dict]:
    """Cardio entries with pace, duration, distance, HR."""
    return analytics.cardio_trends(USER, activity)


@mcp.tool()
def get_body_metrics(metric: str = "weight") -> list[dict]:
    """Time series for a body metric (weight, bicep_l, waist, ...). Values are
    canonical metric units."""
    return analytics.metric_series(USER, metric)


@mcp.tool()
def get_templates() -> dict:
    """Saved workout templates (straight sets, supersets, circuits)."""
    return load_templates(USER)


@mcp.tool()
def get_raw_entries(start_date: str, end_date: str) -> list[dict]:
    """Raw JSONL entries (sets, cardio, session markers) between ISO dates —
    for anything the structured tools don't cover."""
    return iter_entries(config.workouts_dir(USER), start_date, end_date)


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8765)
