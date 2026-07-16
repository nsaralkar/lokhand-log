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
