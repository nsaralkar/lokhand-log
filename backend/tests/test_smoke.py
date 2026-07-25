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
    """Running/cycling/etc: duration or distance metric, no weight concept at all
    (as opposed to bodyweight movements, which track added/assist weight)."""
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
