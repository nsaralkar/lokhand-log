"""Descriptive analytics. Same functions feed the chart API and the MCP tools,
so what Claude sees is exactly what the charts show.

Interpretation (deloads, plateaus, programming advice) is deliberately NOT here —
that's the LLM's job, with these as its inputs.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from . import config
from .library import expand_day, load_exercises
from .storage import iter_entries


def _week_key(ts: str) -> str:
    d = datetime.fromisoformat(ts)
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _set_load_lb(row: dict) -> float:
    """External load on the bar/handle. 0 is a bodyweight set and negative is an
    assisted one — body weight itself is never folded in, so tonnage means the
    same thing for every exercise and doesn't move when the athlete's does."""
    load = row.get("weight_lb")
    if load is None:
        load = row.get("added_weight_lb")   # legacy bodyweight sets
    return load or 0.0


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
    buckets: dict[str, float] = defaultdict(float)
    for row in _work_sets(username, start, end):
        ex = exercises.get(row["exercise_id"])
        if exercise_id and row["exercise_id"] != exercise_id:
            continue
        if muscle and (ex is None or ex.primary != muscle):
            continue
        key = _week_key(row["ts"]) if bucket == "week" else row["ts"][:10]
        buckets[key] += _set_load_lb(row) * (row.get("reps") or 0)
    return [{"bucket": k, "volume_lb": round(v, 1)} for k, v in sorted(buckets.items())]


def session_volumes(username: str, limit: int = 60) -> list[dict]:
    """Total tonnage (load x reps, lb) per workout session, oldest→newest — the
    per-workout view that complements the weekly bucket."""
    starts: dict[str, str] = {}
    vol: dict[str, float] = defaultdict(float)
    for r in iter_entries(config.workouts_dir(username)):
        if r["type"] == "session_start":
            starts[r["session_id"]] = r["ts"]
        elif r.get("type") == "set" and not r.get("warmup"):
            vol[r.get("session_id", "")] += _set_load_lb(r) * (r.get("reps") or 0)
    out = [{"session_id": sid, "date": starts[sid][:10], "volume_lb": round(v, 1)}
           for sid, v in vol.items() if sid in starts]
    out.sort(key=lambda x: starts[x["session_id"]])
    return out[-limit:]


def muscle_group_volume(username: str, weeks: int = 8) -> list[dict]:
    """Weekly tonnage split by primary muscle group — the balance view."""
    exercises = load_exercises()
    table: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in _work_sets(username):
        ex = exercises.get(row["exercise_id"])
        if ex is None:
            continue
        table[_week_key(row["ts"])][ex.primary] += _set_load_lb(row) * (row.get("reps") or 0)
    out = [{"bucket": wk, **{m: round(v, 1) for m, v in groups.items()}}
           for wk, groups in sorted(table.items())]
    return out[-weeks:]


def epley_1rm(load_lb: float, reps: int) -> float:
    return load_lb * (1 + reps / 30) if reps > 1 else load_lb


def _set_score(row: dict) -> float:
    """Progression/PR score for one set, generalized across metrics: est. 1RM
    for reps-based lifts, else the raw duration/distance (bigger is better).
    Duration+distance sets (Peloton, runs...) score on distance covered."""
    if row.get("reps") is not None:
        return epley_1rm(_set_load_lb(row), row["reps"])
    if row.get("distance_mi") is not None:
        return row["distance_mi"]
    return row.get("duration_s") or 0.0


def _set_volume(row: dict) -> float:
    """Work done in one set: load x reps for lifts, else the raw duration or
    distance — the same generalization _set_score makes, summed not maxed."""
    if row.get("reps") is not None:
        return _set_load_lb(row) * row["reps"]
    if row.get("distance_mi") is not None:
        return row["distance_mi"]
    return row.get("duration_s") or 0.0


def exercise_progression(username: str, exercise_id: str, limit_sessions: int = 50) -> dict:
    """Per-session top set + est. 1RM + full recent set detail — the
    'what should I do next' payload used by both the UI and the MCP tool."""
    sessions: dict[str, list[dict]] = defaultdict(list)
    for row in _work_sets(username):
        if row["exercise_id"] == exercise_id:
            sessions[row["session_id"]].append(row)
    out = []
    for sid, sets in sessions.items():
        sets.sort(key=lambda r: r["ts"])
        top = max(sets, key=lambda r: _set_score(r))
        out.append({
            "date": sets[0]["ts"][:10],
            "session_id": sid,
            "top_load_lb": round(_set_load_lb(top), 1),
            "top_reps": top.get("reps"),
            "e1rm_lb": round(_set_score(top), 1),
            "volume_lb": round(sum(_set_volume(s) for s in sets), 1),
            "sets": [{"load_lb": round(_set_load_lb(s), 1), "reps": s.get("reps"),
                      "duration_s": s.get("duration_s"), "distance_mi": s.get("distance_mi"),
                      "rpe": s.get("rpe"), "notes": s.get("notes")} for s in sets],
        })
    out.sort(key=lambda s: s["date"])
    return {"exercise_id": exercise_id, "sessions": out[-limit_sessions:]}


def prs(username: str) -> list[dict]:
    """Best score per exercise (est. 1RM for lifts, best duration/distance for
    holds and carries), plus the load/reps or duration/distance that earned it."""
    best: dict[str, dict] = {}
    for row in _work_sets(username):
        score = _set_score(row)
        cur = best.get(row["exercise_id"])
        if cur is None or score > cur["e1rm_lb"]:
            best[row["exercise_id"]] = {
                "exercise_id": row["exercise_id"], "date": row["ts"][:10],
                "load_lb": round(_set_load_lb(row), 1), "reps": row.get("reps"),
                "duration_s": row.get("duration_s"), "distance_mi": row.get("distance_mi"),
                "e1rm_lb": round(score, 1)}
    return sorted(best.values(), key=lambda r: r["exercise_id"])


def session_summary(username: str, session_id: str) -> dict:
    """Duration, per-set rest deltas (timestamp difference to previous entry),
    tonnage, and the ordered entry list."""
    rows = [r for r in iter_entries(config.workouts_dir(username))
            if r.get("session_id") == session_id]
    rows.sort(key=lambda r: r["ts"])
    entries, prev_ts, tonnage = [], None, 0.0
    for r in rows:
        ts = datetime.fromisoformat(r["ts"])
        delta = int((ts - prev_ts).total_seconds()) if prev_ts else None
        prev_ts = ts
        e = {**r, "since_prev_s": delta}
        if r["type"] == "set" and not r.get("warmup"):
            tonnage += _set_load_lb(r) * (r.get("reps") or 0)
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


def cardio_trends(username: str, exercise_id: Optional[str] = None) -> list[dict]:
    """Sets logged against a `duration+distance` exercise (Peloton, runs...),
    with pace derived — the exercise-based replacement for the old freeform
    cardio entry type."""
    exercises = load_exercises()
    out = []
    for row in _work_sets(username):
        ex = exercises.get(row["exercise_id"])
        if ex is None or ex.metric != "duration+distance":
            continue
        if exercise_id and row["exercise_id"] != exercise_id:
            continue
        dur, dist = row.get("duration_s"), row.get("distance_mi")
        pace = (dur / 60 / dist) if dur and dist else None
        out.append({"date": row["ts"][:10], "exercise_id": row["exercise_id"],
                    "duration_s": dur, "distance_mi": dist,
                    "pace_min_per_mi": round(pace, 2) if pace else None})
    return out


def _fmt_set(row: dict) -> str:
    """One set as a compact string for LLM context, e.g. `33x10 rpe9.5 (note)`."""
    parts = ["warmup"] if row.get("warmup") else []
    load = _set_load_lb(row)
    if row.get("reps") is not None:
        parts.append(f"{load:g}x{row['reps']}")
    elif load:
        parts.append(f"{load:g}lb")
    if row.get("duration_s") is not None:
        m, sec = divmod(int(row["duration_s"]), 60)
        parts.append(f"{m}:{sec:02d}")
    if row.get("distance_mi") is not None:
        parts.append(f"{row['distance_mi']:g}mi")
    if row.get("rpe") is not None:
        parts.append(f"rpe{row['rpe']:g}")
    out = " ".join(parts)
    return f"{out} ({row['notes']})" if row.get("notes") else out


def training_context(username: str, days: int = 14) -> dict:
    """Everything needed to program the next workout, in one read: the athlete
    profile (users/<name>/profile.md), recent body weight, and each session from
    the last `days` days as planned (the routine day snapshotted at start, notes
    included) vs. done (one line of sets per exercise), plus in-session notes.
    Sessions logged before snapshots existed carry only routine/day names."""
    start = (date.today() - timedelta(days=days)).isoformat()
    sessions: dict[str, dict] = {}
    for r in iter_entries(config.workouts_dir(username), start):
        sid = r.get("session_id")
        if r["type"] == "session_start":
            sessions[sid] = {"session_id": sid, "date": r["ts"][:10], "name": r.get("name"),
                             **{k: r[k] for k in ("routine", "day", "planned") if r.get(k)},
                             "done": {}, "notes": [], "_start": r["ts"], "_last": r["ts"],
                             "_open": True}
            continue
        s = sessions.get(sid)
        if s is None:
            continue   # started before the window
        if r["type"] == "set":
            s["done"].setdefault(r["exercise_id"], []).append(_fmt_set(r))
        elif r["type"] == "note":
            s["notes"].append(r["text"])
        elif r["type"] == "session_end":
            s["_open"] = False
            if r.get("notes"):
                s["notes"].append(r["notes"])
            continue   # a late manual end would inflate the duration
        s["_last"] = r["ts"]

    out = []
    for s in sessions.values():
        mins = (datetime.fromisoformat(s.pop("_last"))
                - datetime.fromisoformat(s.pop("_start"))).total_seconds() / 60
        s["duration_min"] = round(mins)
        if s.pop("_open"):
            s["open"] = True
        if not s["notes"]:
            del s["notes"]
        if s.get("planned"):
            planned = Counter(p["exercise_id"] for p in expand_day(s["planned"]))
            done = {ex: sum(1 for x in sets if not x.startswith("warmup"))
                    for ex, sets in s["done"].items()}
            order = list(planned) + [ex for ex in done if ex not in planned]
            diff = {ex: f"{done.get(ex, 0)}/{planned.get(ex, 0)} sets" for ex in order
                    if done.get(ex, 0) != planned.get(ex, 0)}
            if diff:
                s["plan_vs_done"] = diff
        s["done"] = {ex: ", ".join(sets) for ex, sets in s["done"].items()}
        out.append(s)

    profile = config.user_dir(username) / "profile.md"
    return {"as_of": date.today().isoformat(),
            "profile": profile.read_text() if profile.exists() else None,
            "body_weight_lb": {m["date"]: m["value"]
                               for m in metric_series(username, "weight")[-5:]},
            "sessions": out}
