"""Descriptive analytics. Same functions feed the chart API and the MCP tools,
so what Claude sees is exactly what the charts show.

Interpretation (deloads, plateaus, programming advice) is deliberately NOT here —
that's the LLM's job, with these as its inputs.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Optional

from . import config
from .library import load_exercises
from .storage import iter_entries


def _week_key(ts: str) -> str:
    d = datetime.fromisoformat(ts)
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _set_load_lb(row: dict, bodyweight_lb: Optional[float]) -> float:
    """Effective load for tonnage. Bodyweight movements use current body weight
    plus added/assist weight when body weight is known, else just the added weight."""
    if row.get("weight_lb") is not None:
        return row["weight_lb"]
    added = row.get("added_weight_lb") or 0.0
    return (bodyweight_lb or 0.0) + added


def latest_bodyweight_lb(username: str) -> Optional[float]:
    for row in reversed(iter_entries(config.metrics_dir(username))):
        if row.get("metric") == "weight":
            return row["value"]
    return None


def _work_sets(username: str, start=None, end=None) -> list[dict]:
    rows = iter_entries(config.workouts_dir(username), start, end)
    return [r for r in rows if r.get("type") == "set" and not r.get("warmup")]


def volume_over_time(username: str, bucket: str = "week",
                     muscle: Optional[str] = None,
                     exercise_id: Optional[str] = None,
                     start=None, end=None) -> list[dict]:
    """Tonnage (load x reps, lb) per week or per session. Primary muscle only —
    secondary weighting is pseudo-precision we deliberately skip."""
    exercises = load_exercises()
    bw = latest_bodyweight_lb(username)
    buckets: dict[str, float] = defaultdict(float)
    for row in _work_sets(username, start, end):
        ex = exercises.get(row["exercise_id"])
        if exercise_id and row["exercise_id"] != exercise_id:
            continue
        if muscle and (ex is None or ex.primary != muscle):
            continue
        key = _week_key(row["ts"]) if bucket == "week" else row["ts"][:10]
        buckets[key] += _set_load_lb(row, bw) * (row.get("reps") or 0)
    return [{"bucket": k, "volume_lb": round(v, 1)} for k, v in sorted(buckets.items())]


def session_volumes(username: str, limit: int = 60) -> list[dict]:
    """Total tonnage (load x reps, lb) per workout session, oldest→newest — the
    per-workout view that complements the weekly bucket."""
    bw = latest_bodyweight_lb(username)
    starts: dict[str, str] = {}
    vol: dict[str, float] = defaultdict(float)
    for r in iter_entries(config.workouts_dir(username)):
        if r["type"] == "session_start":
            starts[r["session_id"]] = r["ts"]
        elif r.get("type") == "set" and not r.get("warmup"):
            vol[r.get("session_id", "")] += _set_load_lb(r, bw) * (r.get("reps") or 0)
    out = [{"session_id": sid, "date": starts[sid][:10], "volume_lb": round(v, 1)}
           for sid, v in vol.items() if sid in starts]
    out.sort(key=lambda x: starts[x["session_id"]])
    return out[-limit:]


def muscle_group_volume(username: str, weeks: int = 8) -> list[dict]:
    """Weekly tonnage split by primary muscle group — the balance view."""
    exercises = load_exercises()
    bw = latest_bodyweight_lb(username)
    table: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in _work_sets(username):
        ex = exercises.get(row["exercise_id"])
        if ex is None:
            continue
        table[_week_key(row["ts"])][ex.primary] += _set_load_lb(row, bw) * (row.get("reps") or 0)
    out = [{"bucket": wk, **{m: round(v, 1) for m, v in groups.items()}}
           for wk, groups in sorted(table.items())]
    return out[-weeks:]


def epley_1rm(load_lb: float, reps: int) -> float:
    return load_lb * (1 + reps / 30) if reps > 1 else load_lb


def _set_score(row: dict, bw: Optional[float]) -> float:
    """Progression/PR score for one set, generalized across metrics: est. 1RM
    for reps-based lifts, else the raw duration/distance (bigger is better)."""
    if row.get("reps") is not None:
        return epley_1rm(_set_load_lb(row, bw), row["reps"])
    if row.get("duration_s") is not None:
        return row["duration_s"]
    return row.get("distance_mi") or 0.0


def exercise_progression(username: str, exercise_id: str, limit_sessions: int = 50) -> dict:
    """Per-session top set + est. 1RM + full recent set detail — the
    'what should I do next' payload used by both the UI and the MCP tool."""
    bw = latest_bodyweight_lb(username)
    sessions: dict[str, list[dict]] = defaultdict(list)
    for row in _work_sets(username):
        if row["exercise_id"] == exercise_id:
            sessions[row["session_id"]].append(row)
    out = []
    for sid, sets in sessions.items():
        sets.sort(key=lambda r: r["ts"])
        top = max(sets, key=lambda r: _set_score(r, bw))
        out.append({
            "date": sets[0]["ts"][:10],
            "session_id": sid,
            "top_load_lb": round(_set_load_lb(top, bw), 1),
            "top_reps": top.get("reps"),
            "e1rm_lb": round(_set_score(top, bw), 1),
            "sets": [{"load_lb": round(_set_load_lb(s, bw), 1), "reps": s.get("reps"),
                      "duration_s": s.get("duration_s"), "distance_mi": s.get("distance_mi"),
                      "rpe": s.get("rpe"), "notes": s.get("notes")} for s in sets],
        })
    out.sort(key=lambda s: s["date"])
    return {"exercise_id": exercise_id, "sessions": out[-limit_sessions:]}


def prs(username: str) -> list[dict]:
    """Best score per exercise (est. 1RM for lifts, best duration/distance for
    holds and carries), plus the load/reps or duration/distance that earned it."""
    bw = latest_bodyweight_lb(username)
    best: dict[str, dict] = {}
    for row in _work_sets(username):
        score = _set_score(row, bw)
        cur = best.get(row["exercise_id"])
        if cur is None or score > cur["e1rm_lb"]:
            best[row["exercise_id"]] = {
                "exercise_id": row["exercise_id"], "date": row["ts"][:10],
                "load_lb": round(_set_load_lb(row, bw), 1), "reps": row.get("reps"),
                "duration_s": row.get("duration_s"), "distance_mi": row.get("distance_mi"),
                "e1rm_lb": round(score, 1)}
    return sorted(best.values(), key=lambda r: r["exercise_id"])


def session_summary(username: str, session_id: str) -> dict:
    """Duration, per-set rest deltas (timestamp difference to previous entry),
    tonnage, and the ordered entry list."""
    rows = [r for r in iter_entries(config.workouts_dir(username))
            if r.get("session_id") == session_id]
    rows.sort(key=lambda r: r["ts"])
    bw = latest_bodyweight_lb(username)
    entries, prev_ts, tonnage = [], None, 0.0
    for r in rows:
        ts = datetime.fromisoformat(r["ts"])
        delta = int((ts - prev_ts).total_seconds()) if prev_ts else None
        prev_ts = ts
        e = {**r, "since_prev_s": delta}
        if r["type"] == "set" and not r.get("warmup"):
            tonnage += _set_load_lb(r, bw) * (r.get("reps") or 0)
        entries.append(e)
    dur = None
    if len(rows) >= 2:
        dur = int((datetime.fromisoformat(rows[-1]["ts"])
                   - datetime.fromisoformat(rows[0]["ts"])).total_seconds())
    return {"session_id": session_id, "entries": entries,
            "duration_s": dur, "tonnage_lb": round(tonnage, 1)}


def list_sessions(username: str, limit: int = 30) -> list[dict]:
    rows = iter_entries(config.workouts_dir(username))
    starts = [r for r in rows if r["type"] == "session_start"]
    by_sid: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_sid[r.get("session_id", "")].append(r)
    out = []
    for s in starts:
        group = by_sid[s["session_id"]]
        out.append({"session_id": s["session_id"], "date": s["ts"][:10], "ts": s["ts"],
                    "name": s.get("name"),
                    "n_sets": sum(1 for g in group if g["type"] == "set"),
                    "open": not any(g["type"] == "session_end" for g in group)})
    out.sort(key=lambda x: x["ts"], reverse=True)
    return out[:limit]


def metric_series(username: str, metric: str) -> list[dict]:
    return [{"date": r["ts"][:10], "value": r["value"], "unit": r["unit"]}
            for r in iter_entries(config.metrics_dir(username))
            if r.get("metric") == metric]


def cardio_trends(username: str, activity: Optional[str] = None) -> list[dict]:
    out = []
    for r in iter_entries(config.workouts_dir(username)):
        if r.get("type") != "cardio":
            continue
        if activity and r["activity"] != activity:
            continue
        pace = (r["duration_s"] / 60 / r["distance_mi"]) if r.get("distance_mi") else None
        out.append({"date": r["ts"][:10], "activity": r["activity"],
                    "duration_s": r["duration_s"], "distance_mi": r.get("distance_mi"),
                    "pace_min_per_mi": round(pace, 2) if pace else None,
                    "avg_hr": r.get("avg_hr")})
    return out
