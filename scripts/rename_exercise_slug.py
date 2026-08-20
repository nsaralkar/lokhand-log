#!/usr/bin/env python3
"""Rename an exercise slug across the entire lokhand-data dataset.

Updates:
  - the exercise's key in shared/exercises.yaml
  - every reference in shared/routines/*.yaml
  - every reference in users/<name>/templates/**/*.yaml (if any exist)
  - every "exercise_id" field in users/<name>/workouts/*.jsonl

YAML files are edited with a whole-word text substitution (underscore counts
as a word character, so "chpress_db_incline45" won't touch
"chpress_db_incline450" or similar). JSONL files are edited by parsing each
line as JSON and only touching the exercise_id field, so formatting of
untouched lines is preserved exactly.

Usage:
    uv run scripts/rename_exercise_slug.py chpress_db_incline45 chpress_inc45_db
    uv run scripts/rename_exercise_slug.py OLD NEW --dry-run
    uv run scripts/rename_exercise_slug.py OLD NEW --data-dir /path/to/lokhand-data
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

SLUG_RE = re.compile(r"^[a-z0-9_]+$")


def default_data_dir() -> Path:
    env = os.environ.get("LOKHAND_LOG_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "lokhand-data"


def word_pattern(slug: str) -> re.Pattern:
    return re.compile(r"\b" + re.escape(slug) + r"\b")


def replace_in_yaml(path: Path, pattern: re.Pattern, new_slug: str, dry_run: bool) -> int:
    text = path.read_text()
    new_text, count = pattern.subn(new_slug, text)
    if count and not dry_run:
        path.write_text(new_text)
    return count


def replace_in_jsonl(path: Path, old_slug: str, new_slug: str, dry_run: bool) -> int:
    lines = path.read_text().splitlines(keepends=True)
    count = 0
    out_lines = []
    for line in lines:
        body = line.rstrip("\n")
        ending = line[len(body):]
        if not body:
            out_lines.append(line)
            continue
        entry = json.loads(body)
        if entry.get("exercise_id") == old_slug:
            entry["exercise_id"] = new_slug
            body = json.dumps(entry, ensure_ascii=False)
            count += 1
        out_lines.append(body + ending)
    if count and not dry_run:
        path.write_text("".join(out_lines))
    return count


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("old_slug")
    parser.add_argument("new_slug")
    parser.add_argument(
        "--data-dir", type=Path, default=None,
        help="Path to lokhand-data (default: $LOKHAND_LOG_DATA_DIR or ../../lokhand-data)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    parser.add_argument(
        "--force", action="store_true",
        help="Proceed even if new_slug already exists as a different exercise",
    )
    args = parser.parse_args()

    old_slug, new_slug = args.old_slug, args.new_slug
    if old_slug == new_slug:
        sys.exit("old and new slug are identical, nothing to do")
    for slug in (old_slug, new_slug):
        if not SLUG_RE.match(slug):
            sys.exit(f"invalid slug {slug!r}: expected lowercase letters, digits, underscores")

    data_dir = (args.data_dir or default_data_dir()).resolve()
    if not data_dir.is_dir():
        sys.exit(f"data dir not found: {data_dir}")

    exercises_file = data_dir / "shared" / "exercises.yaml"
    exercises_text = exercises_file.read_text() if exercises_file.exists() else ""
    if not word_pattern(old_slug).search(exercises_text):
        print(f"warning: {old_slug!r} not found as a key in {exercises_file}", file=sys.stderr)
    if not args.force and word_pattern(new_slug).search(exercises_text):
        sys.exit(f"{new_slug!r} already exists in {exercises_file} -- pass --force to proceed anyway")

    pattern = word_pattern(old_slug)

    yaml_files = [exercises_file]
    yaml_files += sorted((data_dir / "shared" / "routines").glob("*.yaml"))
    yaml_files += sorted((data_dir / "shared" / "routines").glob("*.yml"))
    for user_dir in sorted((data_dir / "users").glob("*")):
        templates_dir = user_dir / "templates"
        if templates_dir.is_dir():
            yaml_files += sorted(templates_dir.rglob("*.yaml"))
            yaml_files += sorted(templates_dir.rglob("*.yml"))

    jsonl_files = []
    for user_dir in sorted((data_dir / "users").glob("*")):
        workouts_dir = user_dir / "workouts"
        if workouts_dir.is_dir():
            jsonl_files += sorted(workouts_dir.glob("*.jsonl"))

    total = 0
    tag = "[dry-run] " if args.dry_run else ""
    for path in yaml_files:
        if not path.exists():
            continue
        n = replace_in_yaml(path, pattern, new_slug, args.dry_run)
        if n:
            print(f"{tag}{path.relative_to(data_dir)}: {n} replacement(s)")
            total += n

    for path in jsonl_files:
        n = replace_in_jsonl(path, old_slug, new_slug, args.dry_run)
        if n:
            print(f"{tag}{path.relative_to(data_dir)}: {n} set(s) updated")
            total += n

    if total == 0:
        print(f"no occurrences of {old_slug!r} found under {data_dir}")
    else:
        verb = "would update" if args.dry_run else "updated"
        print(f"{verb} {total} occurrence(s): {old_slug!r} -> {new_slug!r}")


if __name__ == "__main__":
    main()
