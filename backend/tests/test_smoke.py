"""Smoke tests over a temp copy of the example data repo. Run: uv run pytest"""
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    shutil.copytree(REPO_ROOT / "data-example", data)
    monkeypatch.setenv("LOKHAND_LOG_DATA_DIR", str(data))
    from app import config
    config.DATA_DIR = data  # config resolves env at import; force for tests
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    r = c.post("/api/login", json={"username": "demo", "password": "demo"})
    assert r.status_code == 200
    return c


def test_log_and_progression(client):
    sid = client.post("/api/sessions/start", json={"name": "test"}).json()["session_id"]
    r = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "chest_press_db_incline",
        "weight_lb": 100, "reps": 12, "rpe": 8, "notes": "felt strong"})
    assert r.status_code == 200 and r.json()["rest_s"] > 0
    prog = client.get("/api/analytics/exercises/chest_press_db_incline/progression").json()
    assert prog["sessions"], "expected at least one session"
    assert client.post(f"/api/sessions/{sid}/end").status_code == 200


def test_edit_and_delete(client):
    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    eid = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "goblet_squat_db",
        "weight_lb": 1000, "reps": 10}).json()["id"]  # fat-finger
    fixed = client.patch(f"/api/entries/{eid}", json={"weight_lb": 55}).json()
    assert fixed["weight_lb"] == 55
    assert client.delete(f"/api/entries/{eid}").json()["ok"]


def test_volume_and_metrics(client):
    assert client.get("/api/analytics/volume").status_code == 200
    client.post("/api/metrics", json={"metric": "bicep_l", "value": 14.0, "unit": "in"})
    series = client.get("/api/metrics/bicep_l").json()
    assert series and series[-1]["value"] == 14.0


def test_duration_and_distance_exercises(client):
    plank = client.post("/api/exercises", json={
        "name": "Plank", "primary": "core", "metric": "duration"}).json()
    carry = client.post("/api/exercises", json={
        "name": "Farmer Carry", "primary": "back", "metric": "distance"}).json()

    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    r = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": plank["id"], "duration_s": 45})
    assert r.status_code == 200
    r = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": carry["id"], "weight_lb": 100, "distance_mi": 0.1})
    assert r.status_code == 200

    # A set must carry exactly one of reps/duration_s/distance_mi.
    bad = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": plank["id"], "duration_s": 30, "reps": 10})
    assert bad.status_code == 422

    # Analytics (tonnage/volume) must not crash on non-reps sets.
    assert client.get("/api/analytics/volume").status_code == 200
    prog = client.get(f"/api/analytics/exercises/{plank['id']}/progression").json()
    assert prog["sessions"][0]["sets"][0]["duration_s"] == 45
    prs = {p["exercise_id"]: p for p in client.get("/api/analytics/prs").json()}
    assert prs[plank["id"]]["e1rm_lb"] == 45
    assert prs[carry["id"]]["distance_mi"] == 0.1


def test_cardio_exercise_tracks_no_weight(client):
    """Running/cycling/etc: duration or distance metric, no weight concept at all."""
    run = client.post("/api/exercises", json={
        "name": "Easy Run", "primary": "cardio", "metric": "distance"}).json()
    assert run["primary"] == "cardio"

    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    r = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": run["id"], "distance_mi": 3.1})
    assert r.status_code == 200

    detail = client.get(f"/api/sessions/{sid}").json()
    set_row = next(e for e in detail["entries"] if e["type"] == "set")
    assert set_row["distance_mi"] == 3.1
    assert "weight_lb" not in set_row and "added_weight_lb" not in set_row

    prog = client.get(f"/api/analytics/exercises/{run['id']}/progression").json()
    assert prog["sessions"][0]["sets"][0]["distance_mi"] == 3.1

    # Doesn't corrupt tonnage-based analytics either.
    assert client.get("/api/analytics/volume").status_code == 200
    assert client.get("/api/analytics/muscle-volume").status_code == 200


def test_progression_reports_session_volume(client):
    """Each session in a progression carries its total work, not just the top
    set's e1RM — that's what the exercise trend plots by default."""
    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    for reps in (10, 8):
        client.post("/api/sets", json={
            "session_id": sid, "exercise_id": "goblet_squat_db",
            "weight_lb": 50, "reps": reps})

    sess = client.get("/api/analytics/exercises/goblet_squat_db/progression").json()["sessions"]
    assert sess[-1]["volume_lb"] == 900.0   # 50x10 + 50x8


def test_weight_is_external_load_only(client):
    """0 lb is a bodyweight set and negative is assisted — neither is special-
    cased, and body weight is never added into tonnage."""
    client.post("/api/metrics", json={"metric": "weight", "value": 180.0, "unit": "lb"})
    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "pullup", "weight_lb": 0, "reps": 10})
    client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "pullup", "weight_lb": -20, "reps": 10})

    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["tonnage_lb"] == -200.0   # 0x10 + (-20)x10; no body weight folded in


def test_legacy_added_weight_folds_into_weight_on_edit(client):
    """Pre-2026-07 bodyweight sets stored their load as added_weight_lb. It reads
    as the load today, and an edit migrates the entry to the one weight field."""
    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    eid = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "pullup",
        "added_weight_lb": 25, "reps": 5}).json()["id"]

    prog = client.get("/api/analytics/exercises/pullup/progression").json()
    assert prog["sessions"][-1]["sets"][-1]["load_lb"] == 25

    fixed = client.patch(f"/api/entries/{eid}", json={"reps": 6}).json()
    assert fixed["weight_lb"] == 25 and "added_weight_lb" not in fixed


def test_edit_set_can_change_exercise_and_metric(client):
    """A logged set is fully editable: re-point it at another exercise, and swap
    which metric field it carries, in one patch."""
    sid = client.post("/api/sessions/start", json={}).json()["session_id"]
    eid = client.post("/api/sets", json={
        "session_id": sid, "exercise_id": "goblet_squat_db",
        "weight_lb": 50, "reps": 10}).json()["id"]
    plank = client.post("/api/exercises", json={
        "name": "Wall Sit", "primary": "quads", "metric": "duration"}).json()

    fixed = client.patch(f"/api/entries/{eid}", json={
        "exercise_id": plank["id"], "reps": None, "distance_mi": None,
        "duration_s": 60, "weight_lb": None, "rpe": 7}).json()
    assert fixed["exercise_id"] == plank["id"] and fixed["duration_s"] == 60
    assert "reps" not in fixed and "weight_lb" not in fixed and fixed["rpe"] == 7


def test_add_exercise_appends_without_touching_existing_bytes(client):
    """A hand-edited exercises.yaml (comments, blank lines) must survive a new
    exercise being added: only new bytes are appended, nothing is reformatted."""
    from app import config
    path = config.exercises_file()
    before = path.read_text()

    created = client.post("/api/exercises", json={
        "name": "Test Curl", "primary": "biceps", "metric": "reps"}).json()

    after = path.read_text()
    assert after.startswith(before)
    assert created["id"] in after[len(before):]

    # A second add should append after the first, still preserving everything above.
    created2 = client.post("/api/exercises", json={
        "name": "Test Curl 2", "primary": "biceps", "metric": "reps"}).json()
    after2 = path.read_text()
    assert after2.startswith(after)
    assert created2["id"] in after2[len(after):]


def test_routine_preview(client):
    r = client.get("/api/routines/dumbbell_split/preview", params={"day": "Push Day"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Push Day"
    assert "chest_press_db_incline" in body["yaml"]

    assert client.get("/api/routines/dumbbell_split/preview",
                      params={"day": "Nonexistent Day"}).status_code == 404
    assert client.get("/api/routines/nope/preview", params={"day": "x"}).status_code == 404
