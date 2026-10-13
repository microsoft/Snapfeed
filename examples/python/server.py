"""
Snapfeed Python backend example — FastAPI + SQLite.

Usage:
    pip install -r requirements.txt
    export SNAPFEED_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
    export SNAPFEED_ALLOWED_ORIGINS="http://localhost:5173"
    uvicorn server:app --port 8420
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

# ── Schema ────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS ui_telemetry (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    seq           INTEGER NOT NULL,
    ts            TEXT    NOT NULL,
    event_type    TEXT    NOT NULL,
    page          TEXT,
    target        TEXT,
    detail_json   TEXT,
    created_at    TEXT    DEFAULT (datetime('now')),
    resolved_at   TEXT,
    resolved_note TEXT,
    commit_sha    TEXT,
    screenshot    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_session ON ui_telemetry(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_type ON ui_telemetry(event_type);
"""

DB_PATH = "snapfeed.db"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@asynccontextmanager
async def lifespan(app: FastAPI):
    token = os.environ.get("SNAPFEED_API_TOKEN", "")
    if not token.strip():
        raise RuntimeError("SNAPFEED_API_TOKEN must be configured with a non-blank secret")
    app.state.api_token = token
    db = get_db()
    db.executescript(SCHEMA)
    db.close()
    yield


# ── Authentication ────────────────────────────────────────────────────

bearer = HTTPBearer(auto_error=False)


def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    token = getattr(request.app.state, "api_token", None)
    if not token:
        raise HTTPException(503, "Server authentication is not configured")
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode("utf-8"), token.encode("utf-8"),
    ):
        raise HTTPException(
            401, "Invalid or missing bearer token", headers={"WWW-Authenticate": "Bearer"},
        )


router = APIRouter(prefix="/api/telemetry", dependencies=[Depends(require_auth)])


# ── Models ────────────────────────────────────────────────────────────

class TelemetryEvent(BaseModel):
    session_id: str
    seq: int
    ts: str
    event_type: str
    page: str | None = None
    target: str | None = None
    detail: dict[str, Any] | None = None
    screenshot: str | None = None


class TelemetryBatch(BaseModel):
    events: list[TelemetryEvent]


# ── Routes ────────────────────────────────────────────────────────────

@router.post("/events")
def ingest_events(batch: TelemetryBatch):
    """Receive a batch of UI telemetry events."""
    db = get_db()
    rows = [
        (
            e.session_id, e.seq, e.ts, e.event_type, e.page, e.target,
            json.dumps(e.detail) if e.detail else None, e.screenshot,
        )
        for e in batch.events
    ]
    db.executemany(
        """INSERT OR IGNORE INTO ui_telemetry
           (session_id, seq, ts, event_type, page, target, detail_json, screenshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    db.commit()
    db.close()
    return {"accepted": len(rows)}


@router.get("/events")
def list_events(
    session_id: str | None = None,
    event_type: str | None = None,
    limit: int = Query(default=200, le=1000),
):
    """Query telemetry events — most recent first."""
    db = get_db()
    clauses: list[str] = []
    params: list[Any] = []
    if session_id:
        clauses.append("session_id = ?")
        params.append(session_id)
    if event_type:
        clauses.append("event_type = ?")
        params.append(event_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)

    cur = db.execute(
        f"SELECT id, session_id, seq, ts, event_type, page, target, detail_json "
        f"FROM ui_telemetry {where} ORDER BY id DESC LIMIT ?",
        params,
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    db.close()
    return rows


@router.get("/sessions")
def list_sessions(limit: int = Query(default=20, le=100)):
    """List telemetry sessions with event counts."""
    db = get_db()
    cur = db.execute(
        """SELECT session_id,
                  MIN(ts) as first_event,
                  MAX(ts) as last_event,
                  COUNT(*) as event_count,
                  SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as error_count
           FROM ui_telemetry
           GROUP BY session_id
           ORDER BY MAX(created_at) DESC
           LIMIT ?""",
        (limit,),
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    db.close()
    return rows


@router.get("/events/{event_id}/screenshot")
def get_screenshot(event_id: int):
    """Serve a feedback screenshot as JPEG."""
    db = get_db()
    row = db.execute(
        "SELECT screenshot FROM ui_telemetry WHERE id = ?", (event_id,)
    ).fetchone()
    db.close()
    if not row or not row[0]:
        raise HTTPException(404, "No screenshot for this event")
    return Response(content=base64.b64decode(row[0]), media_type="image/jpeg")


def health():
    return {"status": "ok"}


def create_app() -> FastAPI:
    origins = [
        origin.strip() for origin in os.environ.get("SNAPFEED_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ]
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment
            or any(character.isspace() for character in origin)
        ):
            raise ValueError("SNAPFEED_ALLOWED_ORIGINS must contain exact HTTP(S) origins")
        # Accessing port also rejects invalid port numbers.
        parsed.port

    app = FastAPI(title="snapfeed-server", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(router)
    app.get("/health")(health)
    return app


app = create_app()
