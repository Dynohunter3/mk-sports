"""FastAPI application."""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .api import accuracy, admin, auth_routes, catalog, feed, leaderboards, matches, picks, users
from .config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class ETagMiddleware:
    """Weak ETags on GET JSON responses; answers If-None-Match with an empty 304.
    Clients polling an unchanged match/feed download a few hundred bytes instead of the body."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "GET":
            return await self.app(scope, receive, send)
        inm = next((v.decode() for k, v in scope["headers"] if k == b"if-none-match"), None)
        start: dict = {}
        chunks: list[bytes] = []

        async def wrapped(message):
            if message["type"] == "http.response.start":
                start.update(message)
                return
            if message["type"] != "http.response.body":
                return await send(message)
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = b"".join(chunks)
            headers = [(k, v) for k, v in start.get("headers", [])]
            ctype = next((v for k, v in headers if k == b"content-type"), b"")
            if start.get("status") == 200 and ctype.startswith(b"application/json"):
                etag = 'W/"' + hashlib.sha1(body).hexdigest()[:20] + '"'
                headers += [(b"etag", etag.encode()), (b"cache-control", b"no-cache"), (b"vary", b"Authorization, Accept-Encoding")]
                if inm and etag in [t.strip() for t in inm.split(",")]:
                    headers = [(k, v) for k, v in headers if k not in (b"content-length", b"content-type")]
                    await send({"type": "http.response.start", "status": 304, "headers": headers})
                    await send({"type": "http.response.body", "body": b""})
                    return
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped)


def create_app(run_scheduler: bool | None = None) -> FastAPI:
    settings = get_settings()
    start_jobs = settings.run_scheduler if run_scheduler is None else run_scheduler

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        sched = None
        if start_jobs:
            from .jobs import start_scheduler

            sched = start_scheduler(settings)
        yield
        if sched is not None:
            sched.shutdown(wait=False)

    app = FastAPI(
        title="PredictPro API",
        version="0.1.0",
        description="AI match predictions and a free-to-play prediction game. "
        "Predictions are for information and entertainment only - not betting advice.",
        lifespan=lifespan,
    )
    app.add_middleware(ETagMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=800)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag"],
    )
    for r in (catalog, matches, feed, picks, leaderboards, accuracy, users, auth_routes, admin):
        app.include_router(r.router, prefix="/api/v1")

    @app.get("/health", tags=["ops"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
