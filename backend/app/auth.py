"""Simple multi-user auth: bcrypt hashes in the data repo's config/users.yaml,
signed session cookie. Appropriate for a LAN/Tailscale home server; not exposed
to the public internet (see docs/DEPLOY.md).

users.yaml shape:
  - username: rachna
    password_hash: "$2b$12$..."
    display_name: Rachna
"""
from __future__ import annotations

import bcrypt
import yaml
from fastapi import Cookie, HTTPException
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import config

_serializer = URLSafeTimedSerializer(config.SECRET_KEY, salt="session")


def _load_users() -> dict[str, dict]:
    path = config.users_config_file()
    raw = yaml.safe_load(path.read_text()) if path.exists() else []
    return {u["username"]: u for u in raw or []}


def verify_login(username: str, password: str) -> dict | None:
    user = _load_users().get(username)
    if user and bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return user
    return None


def make_session_token(username: str) -> str:
    return _serializer.dumps({"u": username})


def current_user(lokhand_log_session: str | None = Cookie(default=None)) -> dict:
    """FastAPI dependency. Raises 401 unless a valid session cookie is present."""
    if not lokhand_log_session:
        raise HTTPException(401, "not logged in")
    try:
        data = _serializer.loads(lokhand_log_session, max_age=config.SESSION_MAX_AGE_S)
    except BadSignature:
        raise HTTPException(401, "invalid session")
    user = _load_users().get(data["u"])
    if user is None:
        raise HTTPException(401, "unknown user")
    return {"username": user["username"],
            "display_name": user.get("display_name", user["username"])}


def hash_password(password: str) -> str:
    """Helper for onboarding users: uv run python -c "from app.auth import hash_password; print(hash_password('...'))" """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
