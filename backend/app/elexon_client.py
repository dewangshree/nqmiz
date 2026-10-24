"""Thin HTTP client for the two Elexon Insights (BMRS) datasets used by the app.

Verified behaviour of the live endpoints (checked against real responses):

* ``GET /datasets/FUELHH/stream`` returns a bare JSON array. It accepts
  ``settlementDateFrom``/``settlementDateTo`` (``yyyy-MM-dd``, UK settlement
  dates) *or* ``publishDateTimeFrom``/``publishDateTimeTo`` - never both - plus
  ``fuelType``. ``generation`` is the average MW over the half-hour.
* ``GET /datasets/WINDFOR/stream`` returns a bare JSON array and only filters by
  ``publishDateTimeFrom``/``publishDateTimeTo`` (ISO-8601, both required
  together). Each publication carries ~73 *hourly* ``startTime`` points.
* Neither stream endpoint paginates; we chunk long ranges ourselves.
* Timestamps are UTC with a ``Z`` suffix. Validation errors return HTTP 400 as
  RFC 9110 problem JSON. No rate-limit headers were observed, but 429 is still
  handled with backoff.
"""
from __future__ import annotations

import logging
import random
import time
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

import httpx

from .config import Settings

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
WINDFOR_CHUNK = timedelta(days=7)


class ElexonError(Exception):
    """Raised when Elexon data cannot be retrieved or is malformed."""

    def __init__(self, message: str, *, status: Optional[int] = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class ElexonClient:
    def __init__(
        self,
        settings: Settings,
        transport: Optional[httpx.BaseTransport] = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._settings = settings
        self._sleep = sleep
        self._http = httpx.Client(
            base_url=settings.elexon_base_url,
            timeout=httpx.Timeout(settings.timeout_seconds),
            headers={"Accept": "application/json", "User-Agent": "wind-forecast-analytics/1.0"},
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def _get_json_array(self, path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        attempts = self._settings.max_retries + 1
        for attempt in range(1, attempts + 1):
            started = time.perf_counter()
            try:
                resp = self._http.get(path, params=params)
            except httpx.TimeoutException as exc:
                err = ElexonError(f"Timed out calling Elexon {path}", retryable=True)
                err.__cause__ = exc
            except httpx.TransportError as exc:
                err = ElexonError(f"Network error calling Elexon {path}: {exc.__class__.__name__}", retryable=True)
                err.__cause__ = exc
            else:
                elapsed_ms = (time.perf_counter() - started) * 1000
                logger.info(
                    "elexon_request path=%s status=%s elapsed_ms=%.0f attempt=%d params=%s",
                    path, resp.status_code, elapsed_ms, attempt, params,
                )
                if resp.status_code == 200:
                    return self._parse_array(path, resp)
                if resp.status_code == 400:
                    # Invalid request: retrying cannot help.
                    raise ElexonError(f"Elexon rejected the request to {path}: {resp.text[:300]}", status=400)
                err = ElexonError(
                    f"Elexon {path} returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    retryable=resp.status_code in RETRYABLE_STATUS,
                )
                if err.retryable and resp.status_code == 429:
                    retry_after = resp.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit() and attempt < attempts:
                        self._sleep(min(float(retry_after), 30.0))
                        continue
            if not err.retryable or attempt == attempts:
                raise err
            delay = min(8.0, 0.5 * 2 ** (attempt - 1)) + random.uniform(0, 0.25)
            logger.warning("elexon_retry path=%s attempt=%d delay=%.2fs reason=%s", path, attempt, delay, err)
            self._sleep(delay)
        raise ElexonError(f"Exhausted retries for {path}")  # pragma: no cover

    @staticmethod
    def _parse_array(path: str, resp: httpx.Response) -> List[Dict[str, Any]]:
        try:
            payload = resp.json()
        except ValueError as exc:
            raise ElexonError(f"Elexon {path} returned a non-JSON body") from exc
        # The stream endpoints return a bare array; the non-stream ones wrap it in {"data": [...]}.
        if isinstance(payload, dict) and isinstance(payload.get("data"), list):
            payload = payload["data"]
        if not isinstance(payload, list):
            raise ElexonError(f"Elexon {path} returned an unexpected payload shape")
        return payload

    def fetch_fuelhh_wind(self, settlement_from: date, settlement_to: date) -> List[Dict[str, Any]]:
        """Actual wind outturn for an inclusive range of UK settlement dates."""
        return self._get_json_array(
            "/datasets/FUELHH/stream",
            {
                "settlementDateFrom": settlement_from.isoformat(),
                "settlementDateTo": settlement_to.isoformat(),
                "fuelType": "WIND",
            },
        )

    def fetch_windfor(self, publish_from: datetime, publish_to: datetime) -> List[Dict[str, Any]]:
        """All WINDFOR publications with publishTime in [publish_from, publish_to], chunked by week."""
        rows: List[Dict[str, Any]] = []
        cursor = publish_from
        while cursor < publish_to:
            chunk_end = min(cursor + WINDFOR_CHUNK, publish_to)
            rows.extend(
                self._get_json_array(
                    "/datasets/WINDFOR/stream",
                    {"publishDateTimeFrom": _iso(cursor), "publishDateTimeTo": _iso(chunk_end)},
                )
            )
            cursor = chunk_end
        return rows
