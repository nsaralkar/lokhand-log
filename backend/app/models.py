"""Entry schemas. One JSON line per entry in monthly JSONL files.

Canonical storage units are METRIC (kg, km, seconds, cm). The API converts for
display based on the user's unit preference; files never mix units.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

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
    """One resistance set. Supersets/circuits = consecutive SetEntries."""
    type: Literal["set"] = "set"
    session_id: str
    exercise_id: str
    weight_kg: Optional[float] = None      # None for pure bodyweight
    added_weight_kg: Optional[float] = None  # bodyweight movements: +weight (belt) or -weight (assist)
    reps: int
    rpe: Optional[float] = None            # 1-10, optional single-tap field
    warmup: bool = False

    @field_validator("rpe")
    @classmethod
    def _rpe_range(cls, v):
        if v is not None and not (1 <= v <= 10):
            raise ValueError("rpe must be 1-10")
        return v


class CardioEntry(BaseEntry):
    type: Literal["cardio"] = "cardio"
    session_id: str
    activity: str                          # run, bike, row, ruck, otf_class...
    duration_s: int
    distance_km: Optional[float] = None
    avg_hr: Optional[int] = None


class SessionStart(BaseEntry):
    type: Literal["session_start"] = "session_start"
    session_id: str = Field(default_factory=new_id)
    name: Optional[str] = None             # e.g. template name
    template: Optional[str] = None


class SessionEnd(BaseEntry):
    type: Literal["session_end"] = "session_end"
    session_id: str
    auto_closed: bool = False


class MetricEntry(BaseEntry):
    """Body metrics: weight (kg), dimensions (cm), and future wearable data.
    `metric` is freeform-but-conventional; see data-example/shared for the list."""
    type: Literal["metric"] = "metric"
    metric: str                            # weight | bicep_l | waist | ...
    value: float
    unit: Literal["kg", "cm", "bpm", "pct"] = "kg"


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
    bodyweight: bool = False
    default_rest_s: int = 120

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
