"""FastAPI application factory, error handling and logging."""
from __future__ import annotations

import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Callable, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .analysis import AnalysisService
from .config import CUTOFF_POLICIES, DEFAULT_ALIGNMENT, DEFAULT_CUTOFF_POLICY, Settings, get_settings
from .elexon_client import ElexonClient, ElexonError
from .repository import SourceRepository
from .routes import InvalidRequest, router

logger = logging.getLogger("app")


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s level=%(levelname)s logger=%(name)s %(message)s",
    )


def _error(status: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "detail": detail})


def create_app(
    settings: Optional[Settings] = None,
    client_factory: Optional[Callable[[], ElexonClient]] = None,
    warm_cache: bool = True,
) -> FastAPI:
    settings = settings or get_settings()
    _configure_logging(settings.log_level)
    repository = SourceRepository(settings, client_factory or (lambda: ElexonClient(settings)))
    service = AnalysisService(repository)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if warm_cache:
            # Load source data in the background so startup never blocks on Elexon.
            def warm():
                try:
                    service.intervals(*_defaults())
                except Exception as exc:  # noqa: BLE001 - logged, surfaced on first request
                    logger.warning("cache_warm_failed error=%s", exc)

            threading.Thread(target=warm, daemon=True).start()
        yield

    app = FastAPI(title="Wind Forecast Analytics API", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.repository = repository
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        request_id = uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response = await call_next(request)
        logger.info(
            "http_request id=%s method=%s path=%s query=%s status=%s elapsed_ms=%.0f",
            request_id, request.method, request.url.path, request.url.query, response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(InvalidRequest)
    async def invalid_request(_: Request, exc: InvalidRequest):
        return _error(400, "invalid_request", exc.detail)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", []) if p != "query")
            parts.append(f"{loc}: {err.get('msg')}")
        return _error(400, "invalid_request", "; ".join(parts) or "Invalid request parameters.")

    @app.exception_handler(ElexonError)
    async def upstream_error(_: Request, exc: ElexonError):
        logger.error("upstream_error status=%s error=%s", exc.status, exc)
        status = 503 if exc.retryable else 502
        return _error(
            status,
            "upstream_unavailable",
            "Elexon data could not be retrieved and no cached copy is available. Please try again shortly.",
        )

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        logger.exception("unhandled_error")
        return _error(500, "internal_error", "An unexpected error occurred while processing the request.")

    @app.get("/", include_in_schema=False)
    def root():
        # The API lives under /api; the UI is served separately by Vite.
        return {
            "service": "Wind Forecast Analytics API",
            "ui": settings.frontend_url,
            "health": "/api/health",
            "docs": "/docs",
        }

    app.include_router(router)
    return app


def _defaults():
    return CUTOFF_POLICIES[DEFAULT_CUTOFF_POLICY], DEFAULT_ALIGNMENT


app = create_app()
