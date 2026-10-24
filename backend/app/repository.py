"""Source-data retrieval with a two-level cache (in-memory + JSON files on disk).

Raw Elexon responses are cached exactly as received, so the cache is a faithful
copy of source data and normalisation can be re-run without network access.
If a refresh fails but a stale cache exists, the stale copy is served and the
response metadata says so.
"""
from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .config import DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST, Settings
from .elexon_client import ElexonClient, ElexonError
from .normalize import ActualRecord, ForecastRecord, QualityReport, normalize_actuals, normalize_forecasts
from .selection import delivery_day_bounds

logger = logging.getLogger(__name__)

# Publications from up to this many days before the first delivery day are fetched,
# so the earliest delivery days still have a full history of eligible forecasts.
FORECAST_LOOKBACK_DAYS = 3


@dataclass(frozen=True)
class SourceInfo:
    dataset: str
    endpoint: str
    params: Dict[str, str]
    fetched_at: datetime
    from_cache: bool
    stale: bool
    rows_received: int


@dataclass(frozen=True)
class SourceData:
    actuals: List[ActualRecord]
    forecasts: List[ForecastRecord]
    actual_quality: QualityReport
    forecast_quality: QualityReport
    sources: List[SourceInfo]
    version: str  # changes whenever source data changes; keys downstream caches


def forecast_publish_window() -> "tuple[datetime, datetime]":
    start, _ = delivery_day_bounds(DELIVERY_DATE_FIRST - timedelta(days=FORECAST_LOOKBACK_DAYS))
    _, end = delivery_day_bounds(DELIVERY_DATE_LAST)
    return start, end


class SourceRepository:
    def __init__(self, settings: Settings, client_factory: Callable[[], ElexonClient]):
        self._settings = settings
        self._client_factory = client_factory
        self._lock = threading.Lock()
        self._data: Optional[SourceData] = None
        self._loaded_at: Optional[datetime] = None

    # -- file cache -------------------------------------------------------
    def _cache_path(self, name: str) -> Path:
        return self._settings.cache_dir / f"{name}.json"

    def _read_cache(self, name: str) -> Optional[Dict[str, Any]]:
        path = self._cache_path(name)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text())
            payload["fetched_at"] = datetime.fromisoformat(payload["fetched_at"])
            if not isinstance(payload.get("rows"), list):
                raise ValueError("rows missing")
            return payload
        except (ValueError, KeyError, OSError) as exc:
            logger.warning("cache_corrupt name=%s error=%s", name, exc)
            return None

    def _write_cache(self, name: str, params: Dict[str, str], rows: List[Dict[str, Any]], fetched_at: datetime) -> None:
        self._settings.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._cache_path(name).with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetched_at": fetched_at.isoformat(), "params": params, "rows": rows}))
        tmp.replace(self._cache_path(name))

    def _load_dataset(
        self,
        name: str,
        dataset: str,
        endpoint: str,
        params: Dict[str, str],
        fetch: Callable[[ElexonClient], List[Dict[str, Any]]],
        force: bool,
    ) -> "tuple[List[Dict[str, Any]], SourceInfo]":
        cached = self._read_cache(name)
        now = datetime.now(timezone.utc)
        ttl = timedelta(hours=self._settings.cache_ttl_hours)
        if cached and cached.get("params") == params and not force and now - cached["fetched_at"] < ttl:
            info = SourceInfo(dataset, endpoint, params, cached["fetched_at"], True, False, len(cached["rows"]))
            return cached["rows"], info
        client = self._client_factory()
        try:
            rows = fetch(client)
        except ElexonError as exc:
            if cached and cached.get("params") == params:
                logger.warning("elexon_refresh_failed_serving_stale dataset=%s error=%s", dataset, exc)
                info = SourceInfo(dataset, endpoint, params, cached["fetched_at"], True, True, len(cached["rows"]))
                return cached["rows"], info
            raise
        finally:
            client.close()
        self._write_cache(name, params, rows, now)
        return rows, SourceInfo(dataset, endpoint, params, now, False, False, len(rows))

    # -- public -----------------------------------------------------------
    def get(self, force_refresh: bool = False) -> SourceData:
        with self._lock:
            if self._data is not None and not force_refresh and not self._expired():
                return self._data
            pub_from, pub_to = forecast_publish_window()
            actual_params = {
                "settlementDateFrom": DELIVERY_DATE_FIRST.isoformat(),
                "settlementDateTo": DELIVERY_DATE_LAST.isoformat(),
                "fuelType": "WIND",
            }
            forecast_params = {
                "publishDateTimeFrom": pub_from.isoformat(),
                "publishDateTimeTo": pub_to.isoformat(),
            }
            actual_rows, actual_info = self._load_dataset(
                "fuelhh_wind", "FUELHH", "/datasets/FUELHH/stream", actual_params,
                lambda c: c.fetch_fuelhh_wind(DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST), force_refresh,
            )
            forecast_rows, forecast_info = self._load_dataset(
                "windfor", "WINDFOR", "/datasets/WINDFOR/stream", forecast_params,
                lambda c: c.fetch_windfor(pub_from, pub_to), force_refresh,
            )
            actuals, aq = normalize_actuals(actual_rows)
            forecasts, fq = normalize_forecasts(forecast_rows)
            version = f"{actual_info.fetched_at.isoformat()}|{forecast_info.fetched_at.isoformat()}"
            self._data = SourceData(actuals, forecasts, aq, fq, [actual_info, forecast_info], version)
            self._loaded_at = datetime.now(timezone.utc)
            logger.info(
                "source_data_loaded actuals=%d forecasts=%d actual_rejected=%s forecast_rejected=%s",
                len(actuals), len(forecasts), dict(aq.rejected), dict(fq.rejected),
            )
            return self._data

    def _expired(self) -> bool:
        if self._loaded_at is None:
            return True
        return datetime.now(timezone.utc) - self._loaded_at >= timedelta(hours=self._settings.cache_ttl_hours)

    @property
    def loaded(self) -> bool:
        return self._data is not None
