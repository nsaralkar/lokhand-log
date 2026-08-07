"""All disk I/O for the private data repo lives in this file.

Rules:
- Logs are append-only in normal operation: one JSON line per entry, monthly files.
- Corrections (edit/delete) rewrite the affected monthly file in place; the git
  commit history is the audit trail (`fix:`-prefixed commits).
- Writes are atomic (tmp file + rename) and serialized behind a process-wide lock.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from . import config
from .models import parse_entry

_LOCK = threading.Lock()


# ---------- low-level jsonl ----------

def _month_key(ts_iso: str) -> str:
    return ts_iso[:7]  # "2026-07"


def _monthly_file(base: Path, ts_iso: str) -> Path:
    return base / f"{_month_key(ts_iso)}.jsonl"


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _write_jsonl_atomic(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def append_entry(base: Path, entry: dict) -> None:
    with _LOCK:
        path = _monthly_file(base, entry["ts"])
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def iter_entries(base: Path, start: Optional[str] = None, end: Optional[str] = None) -> list[dict]:
    """All entries across monthly files, chronological. start/end are ISO date prefixes."""
    rows: list[dict] = []
    if not base.exists():
        return rows
    for path in sorted(base.glob("*.jsonl")):
        month = path.stem
        if start and month < start[:7]:
            continue
        if end and month > end[:7]:
            continue
        rows.extend(_read_jsonl(path))
    rows.sort(key=lambda r: r["ts"])
    if start:
        rows = [r for r in rows if r["ts"] >= start]
    if end:
        rows = [r for r in rows if r["ts"] <= end + "\uffff"]
    return rows


def find_entry(base: Path, entry_id: str) -> Optional[tuple[Path, dict]]:
    for path in sorted(base.glob("*.jsonl")):
        for row in _read_jsonl(path):
            if row.get("id") == entry_id:
                return path, row
    return None


def update_entry(base: Path, entry_id: str, patch: dict) -> dict:
    """Rewrite the monthly file with the patched entry. Re-validates the result."""
    with _LOCK:
        hit = find_entry(base, entry_id)
        if hit is None:
            raise KeyError(entry_id)
        path, old = hit
        merged = {**old, **{k: v for k, v in patch.items() if k not in ("id", "type")}}
        merged = parse_entry(merged).model_dump(exclude_none=True)
        rows = [merged if r.get("id") == entry_id else r for r in _read_jsonl(path)]
        _write_jsonl_atomic(path, rows)
    git_commit(f"fix: edit entry {entry_id}")
    return merged


def delete_entry(base: Path, entry_id: str) -> None:
    with _LOCK:
        hit = find_entry(base, entry_id)
        if hit is None:
            raise KeyError(entry_id)
        path, _ = hit
        rows = [r for r in _read_jsonl(path) if r.get("id") != entry_id]
        _write_jsonl_atomic(path, rows)
    git_commit(f"fix: delete entry {entry_id}")


def delete_session(base: Path, session_id: str) -> int:
    """Remove every entry (start/sets/end) belonging to a session. Returns
    the number of entries removed (0 = session not found). Scans all monthly
    files since a session can, rarely, straddle a month boundary."""
    removed = 0
    with _LOCK:
        for path in sorted(base.glob("*.jsonl")):
            rows = _read_jsonl(path)
            kept = [r for r in rows if r.get("session_id") != session_id]
            if len(kept) != len(rows):
                removed += len(rows) - len(kept)
                _write_jsonl_atomic(path, kept)
    if removed:
        git_commit(f"fix: delete session {session_id}")
    return removed


# ---------- git ops ----------

def git_commit(message: str, push: bool = False) -> str:
    """Commit everything in the data repo. Called by the daily task and by edits.
    Push is opt-in; the deploy docs wire a remote named `backup`."""
    repo = config.DATA_DIR
    if not (repo / ".git").exists():
        return "not a git repo; skipped"
    def run(*args):
        return subprocess.run(["git", "-C", str(repo), *args],
                              capture_output=True, text=True, timeout=30)
    run("add", "-A")
    r = run("commit", "-m", message)
    if "nothing to commit" in (r.stdout + r.stderr):
        return "clean"
    if push:
        run("push", "backup")
    return "committed"


def daily_commit() -> str:
    return git_commit(f"log: {datetime.now().date().isoformat()}", push=True)
