"""Shared exercise library and shared workout routines (both data-repo YAML)."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from . import config
from .models import Exercise


def load_exercises() -> dict[str, Exercise]:
    """Parse the shared library, a mapping of exercise id -> attributes. A YAML
    *syntax* error propagates (the caller surfaces it so a bad hand-edit is
    visible, not a silent empty list); a single entry that fails schema
    validation is skipped so it can't hide the rest."""
    path = config.exercises_file()
    raw = yaml.safe_load(path.read_text()) if path.exists() else {}
    out: dict[str, Exercise] = {}
    for id_, item in (raw or {}).items():
        try:
            ex = Exercise.model_validate({**(item or {}), "id": id_})
        except Exception:
            continue
        out[ex.id] = ex
    return out


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "exercise"


def add_exercise(ex: Exercise) -> Exercise:
    """Persist a new exercise. If its id is blank, derive a unique slug from the
    name (frontend-created exercises don't supply an id)."""
    exercises = load_exercises()
    if not ex.id:
        base = _slugify(ex.name)
        slug, n = base, 2
        while slug in exercises:
            slug, n = f"{base}_{n}", n + 1
        ex = ex.model_copy(update={"id": slug})
    if ex.id in exercises:
        raise ValueError(f"exercise id exists: {ex.id}")
    exercises[ex.id] = ex
    path = config.exercises_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(
        {e.id: e.model_dump(exclude_none=True, exclude={"id"}) for e in exercises.values()},
        sort_keys=False, allow_unicode=True))
    from .storage import git_commit
    git_commit(f"library: add exercise {ex.id}")
    return ex


def load_routines() -> dict[str, dict]:
    """Parse the shared routine library. Each YAML file is one routine (a program
    with a `name` and a list of `days`), keyed here by its file slug. Days each
    hold `blocks`; a day is what you start a session from."""
    rdir = config.routines_dir()
    out: dict[str, dict] = {}
    if rdir.exists():
        for f in sorted(rdir.glob("*.yaml")):
            data = yaml.safe_load(f.read_text()) or {}
            data.setdefault("name", f.stem)   # unnamed file -> its filename is the name
            out[f.stem] = data
    return out


def find_day(routine: dict, day_name: str | None) -> dict | None:
    """Locate a day within a routine by its `name` (falling back to the first day
    when unspecified)."""
    days = routine.get("days", [])
    if not days:
        return None
    if day_name is None:
        return days[0]
    return next((d for d in days if d.get("name") == day_name), None)


def expand_day(day: dict) -> list[dict]:
    """Flatten a routine day's blocks into an ordered list of planned sets. Every
    block is an `exercises` list run for `rounds` rounds — one exercise is a
    straight block, more than one is a superset/circuit. Each round interleaves
    the list, which maps directly onto consecutive SetEntries at log time.

    Each planned set also carries `rest_s`: the short within-block rest when
    another exercise still follows in the same round, else the end-of-block rest
    (so single-exercise blocks always rest the full end-of-block time)."""
    plan: list[dict] = []
    for block in day.get("blocks", []):
        exs = block.get("exercises") or []
        if not exs:
            continue
        last = len(exs) - 1
        for rnd in range(block.get("rounds", 3)):
            for i, ex in enumerate(exs):
                rest = (config.DEFAULT_REST_WITHIN_BLOCK_S if i < last
                        else config.DEFAULT_REST_END_BLOCK_S)
                plan.append({"exercise_id": ex, "block": block.get("label"),
                             "round": rnd + 1, "rest_s": rest})
    return plan
