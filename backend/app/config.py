"""Central configuration. Everything is env-driven so the same code runs under
`uv run` locally and in Docker unchanged."""
import os
from pathlib import Path

# Root of the PRIVATE data git repo (mounted volume in Docker).
DATA_DIR = Path(os.environ.get("FITNESS_DATA_DIR", "../fitness-data")).resolve()

# Secret for signing session cookies. Set a real one in production (see docs/DEPLOY.md).
SECRET_KEY = os.environ.get("FITNESS_SECRET_KEY", "dev-only-insecure-secret")

SESSION_COOKIE = "fitness_session"
SESSION_MAX_AGE_S = 30 * 24 * 3600

# A workout session with no new entries for this long is considered ended.
SESSION_IDLE_TIMEOUT_S = int(os.environ.get("FITNESS_SESSION_IDLE_S", 3 * 3600))

# Global default rest (seconds), two phases: a short rest between exercises
# inside a block (superset transitions) and a longer rest at the end of a block
# — which is also the rest between straight sets. A single-exercise block has no
# "within" transitions, so every one of its rests is the end-of-block rest.
DEFAULT_REST_WITHIN_BLOCK_S = int(os.environ.get("FITNESS_REST_WITHIN_S", 10))
DEFAULT_REST_END_BLOCK_S = int(os.environ.get("FITNESS_REST_END_S", 60))

# Fixed muscle-group taxonomy. Exercises must use these for `primary`/`secondary`.
MUSCLE_GROUPS = [
    "chest", "back", "shoulders", "biceps", "triceps",
    "quads", "hamstrings", "glutes", "calves", "core",
]


def users_dir() -> Path:
    return DATA_DIR / "users"


def user_dir(username: str) -> Path:
    return users_dir() / username


def workouts_dir(username: str) -> Path:
    return user_dir(username) / "workouts"


def metrics_dir(username: str) -> Path:
    return user_dir(username) / "metrics"


def exercises_file() -> Path:
    return DATA_DIR / "shared" / "exercises.yaml"


def routines_dir() -> Path:
    # Routines are shared (like the exercise library): each YAML is one routine
    # with multiple days. Reference them by file slug.
    return DATA_DIR / "shared" / "routines"


def users_config_file() -> Path:
    return DATA_DIR / "config" / "users.yaml"
