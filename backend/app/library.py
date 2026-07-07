"""Shared exercise library (data-repo YAML) and per-user workout templates."""
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


def load_templates(username: str) -> dict[str, dict]:
    tdir = config.templates_dir(username)
    out = {}
    if tdir.exists():
        for f in sorted(tdir.glob("*.yaml")):
            out[f.stem] = yaml.safe_load(f.read_text())
    return out


def save_template(username: str, slug: str, template: dict) -> None:
    tdir = config.templates_dir(username)
    tdir.mkdir(parents=True, exist_ok=True)
    (tdir / f"{slug}.yaml").write_text(
        yaml.safe_dump(template, sort_keys=False, allow_unicode=True))
    from .storage import git_commit
    git_commit(f"template: save {username}/{slug}")


def expand_template(template: dict) -> list[dict]:
    """Flatten a template's blocks into an ordered list of planned sets.
    Straight sets repeat one exercise; supersets/circuits interleave rounds —
    which maps directly onto consecutive SetEntries at log time."""
    plan: list[dict] = []
    for block in template.get("blocks", []):
        btype = block.get("type", "straight")
        if btype == "straight":
            for i in range(block.get("sets", 3)):
                plan.append({"exercise_id": block["exercise"],
                             "target_reps": block.get("target_reps"),
                             "block": block.get("label"), "round": i + 1})
        elif btype in ("superset", "circuit"):
            for rnd in range(block.get("rounds", 3)):
                for ex in block["exercises"]:
                    plan.append({"exercise_id": ex,
                                 "target_reps": block.get("target_reps"),
                                 "block": block.get("label", btype), "round": rnd + 1})
    return plan
