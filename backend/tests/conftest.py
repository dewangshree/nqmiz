"""Deterministic synthetic fixtures for unit tests. These are NOT Elexon observations."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List

import pytest

from app.config import DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST, Settings


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fuelhh_rows(first: date, last: date, mw: float = 10000.0) -> List[Dict]:
    """Half-hourly WIND rows for January-like dates (GMT == UTC)."""
    rows = []
    d = first
    while d <= last:
        for p in range(48):
            start = utc(d.year, d.month, d.day) + timedelta(minutes=30 * p)
            rows.append(
                {
                    "dataset": "FUELHH",
                    "publishTime": iso(start + timedelta(minutes=30)),
                    "startTime": iso(start),
                    "settlementDate": d.isoformat(),
                    "settlementPeriod": p + 1,
                    "fuelType": "WIND",
                    "generation": mw,
                }
            )
        d += timedelta(days=1)
    return rows


def windfor_rows(publish_times: List[datetime], offset_mw: Dict[datetime, float], base_mw: float = 10000.0) -> List[Dict]:
    """Each publication covers hourly points from its publish hour to +72h."""
    rows = []
    for pub in publish_times:
        first = pub.replace(minute=0, second=0)
        for h in range(73):
            start = first + timedelta(hours=h)
            rows.append(
                {
                    "dataset": "WINDFOR",
                    "publishTime": iso(pub),
                    "startTime": iso(start),
                    "generation": base_mw + offset_mw.get(pub, 0.0),
                }
            )
    return rows


class FakeClient:
    """Stands in for ElexonClient; records calls and can be told to fail."""

    def __init__(self, actual_rows, forecast_rows, fail: Exception = None):
        self.actual_rows = actual_rows
        self.forecast_rows = forecast_rows
        self.fail = fail
        self.calls = []

    def fetch_fuelhh_wind(self, a, b):
        self.calls.append(("FUELHH", a, b))
        if self.fail:
            raise self.fail
        return self.actual_rows

    def fetch_windfor(self, a, b):
        self.calls.append(("WINDFOR", a, b))
        if self.fail:
            raise self.fail
        return self.forecast_rows

    def close(self):
        pass


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        elexon_base_url="https://example.invalid",
        timeout_seconds=1,
        max_retries=2,
        cache_dir=tmp_path / "cache",
        cache_ttl_hours=24,
        cors_origins=["http://localhost:5173"],
        log_level="WARNING",
    )


@pytest.fixture
def period_fixture():
    """Full-period fixture: forecasts published daily at 07:30 and 09:30 UTC, actual = 10,000 MW.

    The 09:30 publication forecasts +500 MW, the 07:30 one +200 MW and a 10:30
    (post-cutoff) one +9,000 MW, so the selected publication is identifiable
    from the error alone.
    """
    pubs, offsets = [], {}
    d = DELIVERY_DATE_FIRST - timedelta(days=2)
    while d <= DELIVERY_DATE_LAST:
        for hh, mm, off in ((7, 30, 200.0), (9, 30, 500.0), (10, 30, 9000.0)):
            p = utc(d.year, d.month, d.day, hh, mm)
            pubs.append(p)
            offsets[p] = off
        d += timedelta(days=1)
    actual = fuelhh_rows(DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST)
    forecast = windfor_rows(pubs, offsets)
    return actual, forecast
