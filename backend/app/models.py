"""Entry schemas. One JSON line per entry in monthly JSONL files.

Canonical storage units are IMPERIAL (lb, mi, in, seconds) — the units the
athlete actually trains in, so the plain-text files read the way they think.
No unit conversion happens anywhere; files never mix units.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import MUSCLE_GROUPS


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class BaseEntry(BaseModel):
    id: str = Field(default_factory=new_id)
    ts: str = Field(default_factory=now_iso)   # ISO-8601 with offset
    notes: Optional[str] = None                # freeform; lives with the entry


class SetEntry(BaseEntry):
    """One resistance set. Supersets/circuits = consecutive SetEntries.
    Exactly one of reps/duration_s/distance_mi is set, per the exercise's
    `metric` (reps for lifts, duration for holds, distance for carries/runs)."""
    type: Literal["set"] = "set"
    session_id: str
    exercise_id: str
    weight_lb: Optional[float] = None      # None for pure bodyweight
    added_weight_lb: Optional[float] = None  # bodyweight movements: +weight (belt) or -weight (assist)
    reps: Optional[int] = None
    duration_s: Optional[int] = None
    distance_mi: Optional[float] = None
    rpe: Optional[float] = None            # 1-10, optional single-tap field
    warmup: bool = False

    @field_validator("rpe")
    @classmethod
    def _rpe_range(cls, v):
        if v is not None and not (1 <= v <= 10):
            raise ValueError("rpe must be 1-10")
        return v

    @model_validator(mode="after")
    def _one_metric(self):
        if sum(x is not None for x in (self.reps, self.duration_s, self.distance_mi)) != 1:
            raise ValueError("set needs exactly one of reps, duration_s, distance_mi")
        return self


class CardioEntry(BaseEntry):
    type: Literal["cardio"] = "cardio"
    session_id: str
    activity: str                          # run, bike, row, ruck, otf_class...
    duration_s: int
    distance_mi: Optional[float] = None
    avg_hr: Optional[int] = None


class SessionStart(BaseEntry):
    type: Literal["session_start"] = "session_start"
    session_id: str = Field(default_factory=new_id)
    name: Optional[str] = None             # e.g. the routine day's name
    routine: Optional[str] = None          # routine slug this session came from
    day: Optional[str] = None              # which day within the routine


class SessionEnd(BaseEntry):
    type: Literal["session_end"] = "session_end"
    session_id: str
    auto_closed: bool = False


class MetricEntry(BaseEntry):
    """Body metrics: weight (lb), dimensions (in), and future wearable data.
    `metric` is freeform-but-conventional; see data-example/shared for the list."""
    type: Literal["metric"] = "metric"
    metric: str                            # weight | bicep_l | waist | ...
    value: float
    unit: Literal["lb", "in", "bpm", "pct"] = "lb"


ENTRY_TYPES = {
    "set": SetEntry,
    "cardio": CardioEntry,
    "session_start": SessionStart,
    "session_end": SessionEnd,
    "metric": MetricEntry,
}


def parse_entry(d: dict):
    cls = ENTRY_TYPES.get(d.get("type"))
    if cls is None:
        raise ValueError(f"unknown entry type: {d.get('type')!r}")
    return cls.model_validate(d)


class Exercise(BaseModel):
    id: str = ""                            # blank on create; backend assigns a slug
    name: str
    equipment: Optional[str] = None        # barbell | dumbbell | cable | machine | bodyweight
    primary: str
    secondary: list[str] = []
    metric: Literal["reps", "duration", "distance"] = "reps"  # how sets are counted
    bodyweight: bool = False
    default_rest_s: int = 120
    notes: Optional[str] = None            # form cues / setup reminders, shown on the Info tab

    @field_validator("primary")
    @classmethod
    def _primary_valid(cls, v):
        if v not in MUSCLE_GROUPS:
            raise ValueError(f"primary must be one of {MUSCLE_GROUPS}")
        return v

    @field_validator("secondary")
    @classmethod
    def _secondary_valid(cls, v):
        bad = [m for m in v if m not in MUSCLE_GROUPS]
        if bad:
            raise ValueError(f"unknown muscle groups: {bad}")
        return v
