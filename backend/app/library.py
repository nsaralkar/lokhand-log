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


def exercise_entry_yaml(id_: str) -> str | None:
    """YAML for one exercise's attributes (no id key -- the id is fixed by the
    button/URL that got you here), for the Library page's preview/edit dialog.
    None if the id doesn't exist."""
    ex = load_exercises().get(id_)
    if ex is None:
        return None
    return yaml.safe_dump(ex.model_dump(exclude_none=True, exclude={"id"}),
                          sort_keys=False, allow_unicode=True)


def update_exercise(id_: str, text: str) -> Exercise:
    """Validate a hand-edited attributes block and overwrite that one entry.
    Unlike add_exercise's append, an edit can touch any existing key, so this
    round-trips the whole file through yaml.safe_dump -- comments are
    preserved on add (append-only) but not on edit (full rewrite)."""
    path = config.exercises_file()
    raw = yaml.safe_load(path.read_text()) if path.exists() else {}
    if not isinstance(raw, dict) or id_ not in raw:
        raise ValueError(f"exercise not found: {id_}")
    attrs = yaml.safe_load(text) or {}
    if not isinstance(attrs, dict):
        raise ValueError("an exercise entry must be a mapping of attributes")
    ex = Exercise.model_validate({**attrs, "id": id_})
    raw[id_] = ex.model_dump(exclude_none=True, exclude={"id"})
    path.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True))
    from .storage import git_commit
    git_commit(f"library: edit exercise {id_}")
    return ex


def add_exercise(ex: Exercise) -> Exercise:
    """Persist a new exercise. If its id is blank, derive a unique slug from the
    name (frontend-created exercises don't supply an id).

    Appends the new entry's YAML block to the end of the file rather than
    reloading and re-dumping every existing entry -- exercises.yaml is hand-
    edited (comments, blank lines, multi-line notes) and a full round-trip
    through yaml.safe_dump would flatten all of that formatting away. The
    file on disk is treated as opaque text; only the appended bytes are new."""
    exercises = load_exercises()
    if not ex.id:
        base = _slugify(ex.name)
        slug, n = base, 2
        while slug in exercises:
            slug, n = f"{base}_{n}", n + 1
        ex = ex.model_copy(update={"id": slug})
    if ex.id in exercises:
        raise ValueError(f"exercise id exists: {ex.id}")
    path = config.exercises_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    entry_yaml = yaml.safe_dump(
        {ex.id: ex.model_dump(exclude_none=True, exclude={"id"})},
        sort_keys=False, allow_unicode=True)
    existing = path.read_text() if path.exists() else ""
    sep = "" if not existing or existing.endswith("\n\n") else ("\n" if existing.endswith("\n") else "\n\n")
    path.write_text(existing + sep + entry_yaml)
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


def _routine_path(slug: str) -> Path:
    return config.routines_dir() / f"{slug}.yaml"


def _parse_day(text: str) -> dict:
    day = yaml.safe_load(text) or {}
    if not isinstance(day, dict):
        raise ValueError("a routine day must be a mapping (name, blocks, ...)")
    return day


def add_routine_day(slug: str, text: str) -> dict:
    """Append a new day (hand-typed YAML) to an existing routine file. Whole-
    file round-trip through yaml.safe_dump, like update_exercise -- comments
    aren't preserved on this path."""
    path = _routine_path(slug)
    if not path.exists():
        raise ValueError(f"routine not found: {slug}")
    routine = yaml.safe_load(path.read_text()) or {}
    day = _parse_day(text)
    routine.setdefault("days", []).append(day)
    path.write_text(yaml.safe_dump(routine, sort_keys=False, allow_unicode=True))
    from .storage import git_commit
    git_commit(f"library: add day to routine {slug}")
    return day


def update_routine_day(slug: str, idx: int, text: str) -> dict:
    """Replace one day (by its position in the file) with a hand-edited
    version -- the position is what the frontend already has from the list
    it rendered, so it's unambiguous even for unnamed days."""
    path = _routine_path(slug)
    if not path.exists():
        raise ValueError(f"routine not found: {slug}")
    routine = yaml.safe_load(path.read_text()) or {}
    days = routine.get("days") or []
    if not (0 <= idx < len(days)):
        raise ValueError(f"day index out of range: {idx}")
    days[idx] = _parse_day(text)
    routine["days"] = days
    path.write_text(yaml.safe_dump(routine, sort_keys=False, allow_unicode=True))
    from .storage import git_commit
    git_commit(f"library: edit day in routine {slug}")
    return days[idx]


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

    Each planned set also carries `rest_s`, picked from the set's position:
    the within-block rest when another exercise follows in the same round, the
    between-rounds rest after a round finishes with more rounds to go, else the
    end-of-block rest. A block's YAML may override any phase (rest_within_s,
    rest_between_rounds_s, rest_end_s) or all at once (rest_s)."""
    plan: list[dict] = []
    for block in day.get("blocks", []):
        exs = block.get("exercises") or []
        if not exs:
            continue

        def rest_of(key: str, default: int) -> int:
            v = block.get(key, block.get("rest_s"))
            return default if v is None else int(v)

        last = len(exs) - 1
        rounds = block.get("rounds", 3)
        for rnd in range(rounds):
            for i, ex in enumerate(exs):
                if i < last:
                    rest = rest_of("rest_within_s", config.DEFAULT_REST_WITHIN_BLOCK_S)
                elif rnd < rounds - 1:
                    rest = rest_of("rest_between_rounds_s", config.DEFAULT_REST_BETWEEN_BLOCK_S)
                else:
                    rest = rest_of("rest_end_s", config.DEFAULT_REST_END_BLOCK_S)
                plan.append({"exercise_id": ex, "block": block.get("label"),
                             "round": rnd + 1, "rest_s": rest})
    return plan
