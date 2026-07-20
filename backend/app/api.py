"""All HTTP endpoints. Thin layer: validate -> storage/analytics -> JSON."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from . import analytics, config, storage
from .auth import current_user, make_session_token, verify_login
from .library import (add_exercise, expand_day, find_day, load_exercises,
                      load_routines)
from .models import (CardioEntry, Exercise, MetricEntry, SessionEnd,
                     SessionStart, SetEntry)

router = APIRouter(prefix="/api")


# ---------- auth ----------

class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginBody, response: Response):
    user = verify_login(body.username, body.password)
    if user is None:
        raise HTTPException(401, "bad credentials")
    response.set_cookie(config.SESSION_COOKIE, make_session_token(user["username"]),
                        max_age=config.SESSION_MAX_AGE_S, httponly=True, samesite="lax")
    return {"username": user["username"],
            "display_name": user.get("display_name", user["username"])}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(config.SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return user


# ---------- exercise library ----------

@router.get("/exercises")
def exercises(user=Depends(current_user)):
    try:
        return [e.model_dump() for e in load_exercises().values()]
    except yaml.YAMLError as e:
        raise HTTPException(500, f"exercises.yaml parse error: {e}")


@router.post("/exercises")
def create_exercise(ex: Exercise, user=Depends(current_user)):
    try:
        return add_exercise(ex).model_dump()
    except ValueError as e:
        raise HTTPException(409, str(e))


# ---------- sessions & logging ----------

def _auto_close_stale(username: str):
    """Session lifecycle: any open session idle > SESSION_IDLE_TIMEOUT_S gets an
    auto-close entry stamped at its last activity."""
    rows = storage.iter_entries(config.workouts_dir(username))
    open_sessions: dict[str, str] = {}
    for r in rows:
        if r["type"] == "session_start":
            open_sessions[r["session_id"]] = r["ts"]
        elif r["type"] == "session_end":
            open_sessions.pop(r["session_id"], None)
        elif r.get("session_id") in open_sessions:
            open_sessions[r["session_id"]] = r["ts"]
    now = datetime.now(timezone.utc)
    for sid, last_ts in open_sessions.items():
        idle = (now - datetime.fromisoformat(last_ts)).total_seconds()
        if idle > config.SESSION_IDLE_TIMEOUT_S:
            end = SessionEnd(session_id=sid, ts=last_ts, auto_closed=True)
            storage.append_entry(config.workouts_dir(username),
                                 end.model_dump(exclude_none=True))


class SessionStartBody(BaseModel):
    name: Optional[str] = None
    routine: Optional[str] = None          # routine slug
    day: Optional[str] = None              # day name within the routine


@router.post("/sessions/start")
def start_session(body: SessionStartBody, user=Depends(current_user)):
    _auto_close_stale(user["username"])
    plan = None
    name = body.name
    if body.routine:
        routine = load_routines().get(body.routine)
        day = find_day(routine, body.day) if routine else None
        if day:
            plan = expand_day(day)
            name = name or day.get("name")
    entry = SessionStart(name=name, routine=body.routine, day=body.day)
    storage.append_entry(config.workouts_dir(user["username"]),
                         entry.model_dump(exclude_none=True))
    return {"session_id": entry.session_id, "plan": plan}


class SessionEndBody(BaseModel):
    notes: Optional[str] = None            # freeform notes for the whole session


@router.post("/sessions/{session_id}/end")
def end_session(session_id: str, body: SessionEndBody = SessionEndBody(),
                user=Depends(current_user)):
    entry = SessionEnd(session_id=session_id, notes=body.notes)
    storage.append_entry(config.workouts_dir(user["username"]),
                         entry.model_dump(exclude_none=True))
    storage.git_commit(f"log: session {session_id} ({user['username']})")
    return {"ok": True}


@router.get("/sessions")
def sessions(limit: int = 30, user=Depends(current_user)):
    _auto_close_stale(user["username"])
    return analytics.list_sessions(user["username"], limit)


@router.get("/sessions/{session_id}")
def session_detail(session_id: str, user=Depends(current_user)):
    return analytics.session_summary(user["username"], session_id)


@router.delete("/sessions/{session_id}")
def remove_session(session_id: str, user=Depends(current_user)):
    """Delete a whole session and all its entries. The git commit is the audit
    trail (individual set edits/deletes remain per-entry via /entries/{id})."""
    removed = storage.delete_session(config.workouts_dir(user["username"]), session_id)
    if not removed:
        raise HTTPException(404, "session not found")
    return {"ok": True, "removed": removed}


@router.post("/sets")
def log_set(entry: SetEntry, user=Depends(current_user)):
    ex = load_exercises().get(entry.exercise_id)
    if ex is None:
        raise HTTPException(400, f"unknown exercise: {entry.exercise_id}")
    storage.append_entry(config.workouts_dir(user["username"]),
                         entry.model_dump(exclude_none=True))
    # Off-plan / empty-workout fallback: the end-of-block default. In-plan sets
    # carry their own positional rest_s (from expand_day); the client prefers it.
    return {"id": entry.id, "ts": entry.ts, "rest_s": config.DEFAULT_REST_END_BLOCK_S}


@router.post("/cardio")
def log_cardio(entry: CardioEntry, user=Depends(current_user)):
    storage.append_entry(config.workouts_dir(user["username"]),
                         entry.model_dump(exclude_none=True))
    return {"id": entry.id, "ts": entry.ts}


# ---------- corrections (edit/delete; git commit is the audit trail) ----------

@router.patch("/entries/{entry_id}")
def edit_entry(entry_id: str, patch: dict, user=Depends(current_user)):
    for base in (config.workouts_dir(user["username"]), config.metrics_dir(user["username"])):
        try:
            return storage.update_entry(base, entry_id, patch)
        except KeyError:
            continue
    raise HTTPException(404, "entry not found")


@router.delete("/entries/{entry_id}")
def remove_entry(entry_id: str, user=Depends(current_user)):
    for base in (config.workouts_dir(user["username"]), config.metrics_dir(user["username"])):
        try:
            storage.delete_entry(base, entry_id)
            return {"ok": True}
        except KeyError:
            continue
    raise HTTPException(404, "entry not found")


# ---------- metrics ----------

@router.post("/metrics")
def log_metric(entry: MetricEntry, user=Depends(current_user)):
    storage.append_entry(config.metrics_dir(user["username"]),
                         entry.model_dump(exclude_none=True))
    return {"id": entry.id}


@router.get("/metrics/{metric}")
def metric_series(metric: str, user=Depends(current_user)):
    return analytics.metric_series(user["username"], metric)


# ---------- routines ----------

@router.get("/routines")
def routines(user=Depends(current_user)):
    return load_routines()


# ---------- analytics ----------

@router.get("/analytics/volume")
def volume(bucket: str = "week", muscle: Optional[str] = None,
           exercise_id: Optional[str] = None, user=Depends(current_user)):
    return analytics.volume_over_time(user["username"], bucket, muscle, exercise_id)


@router.get("/analytics/session-volume")
def session_volume(user=Depends(current_user)):
    return analytics.session_volumes(user["username"])


@router.get("/analytics/muscle-volume")
def muscle_volume(weeks: int = 8, user=Depends(current_user)):
    return {"muscle_groups": config.MUSCLE_GROUPS,
            "data": analytics.muscle_group_volume(user["username"], weeks)}


@router.get("/analytics/exercises/{exercise_id}/progression")
def progression(exercise_id: str, user=Depends(current_user)):
    return analytics.exercise_progression(user["username"], exercise_id)


@router.get("/analytics/prs")
def prs(user=Depends(current_user)):
    return analytics.prs(user["username"])


@router.get("/analytics/cardio")
def cardio(activity: Optional[str] = None, user=Depends(current_user)):
    return analytics.cardio_trends(user["username"], activity)


# ---------- admin ----------

@router.post("/admin/commit")
def commit_now(user=Depends(current_user)):
    return {"result": storage.daily_commit()}
