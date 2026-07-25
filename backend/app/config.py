"""Central configuration. Everything is env-driven so the same code runs under
`uv run` locally and in Docker unchanged."""
import os
from pathlib import Path

# Root of the PRIVATE data git repo (mounted volume in Docker).
DATA_DIR = Path(os.environ.get("LOKHAND_LOG_DATA_DIR", "../fitness-data")).resolve()

# Secret for signing session cookies. Set a real one in production (see docs/DEPLOY.md).
SECRET_KEY = os.environ.get("LOKHAND_LOG_SECRET_KEY", "dev-only-insecure-secret")

SESSION_COOKIE = "lokhand_log_session"
SESSION_MAX_AGE_S = 30 * 24 * 3600

# A workout session with no new entries for this long is considered ended.
SESSION_IDLE_TIMEOUT_S = int(os.environ.get("LOKHAND_LOG_SESSION_IDLE_S", 3 * 3600))

# Global default rest (seconds), three phases within a block:
#   WITHIN  — between exercises inside one round (superset/circuit transitions)
#   BETWEEN — after finishing a round, before the next round (also between the
#             straight sets of a single-exercise block)
#   END     — after the final round, before moving on to the next block
# A routine block can override any of these in its YAML (rest_within_s,
# rest_between_rounds_s, rest_end_s, or a block-wide rest_s).
DEFAULT_REST_WITHIN_BLOCK_S = int(os.environ.get("LOKHAND_LOG_REST_WITHIN_S", 10))
DEFAULT_REST_BETWEEN_BLOCK_S = int(os.environ.get("LOKHAND_LOG_REST_BETWEEN_S", 60))
DEFAULT_REST_END_BLOCK_S = int(os.environ.get("LOKHAND_LOG_REST_END_S", 60))

# Fixed muscle-group taxonomy. Exercises must use these for `primary`/`secondary`.
# `cardio` is a pseudo-group for duration/distance activities (running, cycling,
# rowing...) that have no real primary muscle to attribute tonnage to.
MUSCLE_GROUPS = [
    "chest", "back", "shoulders", "biceps", "triceps",
    "quads", "hamstrings", "glutes", "calves", "core", "cardio",
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
