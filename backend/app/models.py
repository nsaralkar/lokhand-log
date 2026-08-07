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
    `metric` (reps for lifts, duration for holds, distance for carries/runs) --
    except `duration+distance` exercises (Peloton, runs...), which carry both
    duration_s and distance_mi together and no reps."""
    type: Literal["set"] = "set"
    session_id: str
    exercise_id: str
    # External load only: 0 means bodyweight (a strict pullup), negative means
    # assisted (band/machine). Body weight itself is never part of the number.
    weight_lb: Optional[float] = None
    added_weight_lb: Optional[float] = None  # legacy: pre-2026-07 bodyweight sets; folded into weight_lb
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
        n = sum(x is not None for x in (self.reps, self.duration_s, self.distance_mi))
        if n == 2 and self.reps is None:
            return self   # duration_s + distance_mi together (duration+distance exercises)
        if n != 1:
            raise ValueError("set needs exactly one of reps, duration_s, distance_mi "
                             "(or duration_s and distance_mi together)")
        return self

    @model_validator(mode="after")
    def _fold_legacy_added_weight(self):
        """Older logs split load across weight_lb (external) and added_weight_lb
        (bodyweight movements). There is one load field now, so a legacy entry
        migrates the first time it's re-validated (i.e. on edit)."""
        if self.added_weight_lb is not None:
            if self.weight_lb is None:
                self.weight_lb = self.added_weight_lb
            self.added_weight_lb = None
        return self


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
    metric: Literal["reps", "duration", "distance", "duration+distance"] = "reps"  # how sets are counted
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
