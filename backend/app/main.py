"""App entrypoint. Local debug:
    FITNESS_DATA_DIR=../../fitness-data uv run uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI

from .api import router
from .storage import daily_commit

log = logging.getLogger("fitness")


async def _daily_commit_loop():
    """Commit (and push to the `backup` remote, if configured) once a day.
    Edits/deletes and session-ends commit immediately; this catches the rest."""
    while True:
        await asyncio.sleep(24 * 3600)
        try:
            log.info("daily commit: %s", daily_commit())
        except Exception:
            log.exception("daily commit failed")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_daily_commit_loop())
    yield
    task.cancel()


app = FastAPI(title="fitness-app", lifespan=lifespan)
app.include_router(router)


@app.get("/api/health")
def health():
    return {"ok": True}
