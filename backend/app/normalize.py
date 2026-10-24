"""Validation, normalisation and de-duplication of raw Elexon records.

Raw API rows are converted into small immutable records with timezone-aware UTC
datetimes and float MW values. Invalid rows are dropped *and counted* so data
quality can be reported rather than silently hidden. Missing generation values
are never coerced to zero.
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class ActualRecord:
    start_time: datetime  # UTC, start of the 30-minute delivery interval
    settlement_date: date
    settlement_period: int
    generation_mw: float  # average MW over the half-hour (FUELHH)
    publish_time: datetime


@dataclass(frozen=True)
class ForecastRecord:
    publish_time: datetime  # UTC
    start_time: datetime  # UTC, hourly forecast point
    generation_mw: float


@dataclass
class QualityReport:
    received: int = 0
    accepted: int = 0
    rejected: Counter = field(default_factory=Counter)
    duplicates_removed: int = 0
    conflicting_duplicates: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "received": self.received,
            "accepted": self.accepted,
            "rejected": dict(self.rejected),
            "duplicates_removed": self.duplicates_removed,
            "conflicting_duplicates": self.conflicting_duplicates,
        }


def parse_utc(value: Any) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp into an aware UTC datetime. Naive input is rejected."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def _parse_mw(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return v if math.isfinite(v) else None


def normalize_actuals(rows: Iterable[Dict[str, Any]]) -> Tuple[List[ActualRecord], QualityReport]:
    report = QualityReport()
    by_start: Dict[datetime, List[ActualRecord]] = {}
    for row in rows:
        report.received += 1
        if not isinstance(row, dict):
            report.rejected["not_an_object"] += 1
            continue
        if row.get("fuelType") != "WIND":
            report.rejected["not_wind"] += 1
            continue
        start = parse_utc(row.get("startTime"))
        publish = parse_utc(row.get("publishTime"))
        mw = _parse_mw(row.get("generation"))
        period = row.get("settlementPeriod")
        try:
            sdate = date.fromisoformat(row.get("settlementDate") or "")
        except (TypeError, ValueError):
            sdate = None
        if start is None or publish is None:
            report.rejected["invalid_timestamp"] += 1
            continue
        if start.minute not in (0, 30) or start.second or start.microsecond:
            report.rejected["misaligned_interval"] += 1
            continue
        if mw is None:
            report.rejected["missing_generation"] += 1
            continue
        if sdate is None or not isinstance(period, int):
            report.rejected["invalid_settlement_fields"] += 1
            continue
        by_start.setdefault(start, []).append(ActualRecord(start, sdate, period, mw, publish))

    out: List[ActualRecord] = []
    for start in sorted(by_start):
        candidates = by_start[start]
        if len(candidates) > 1:
            report.duplicates_removed += len(candidates) - 1
            if len({c.generation_mw for c in candidates}) > 1:
                report.conflicting_duplicates += 1
        # Deterministic: prefer the most recently published revision.
        out.append(max(candidates, key=lambda r: (r.publish_time, r.generation_mw)))
    report.accepted = len(out)
    return out, report


def normalize_forecasts(rows: Iterable[Dict[str, Any]]) -> Tuple[List[ForecastRecord], QualityReport]:
    report = QualityReport()
    by_key: Dict[Tuple[datetime, datetime], List[float]] = {}
    for row in rows:
        report.received += 1
        if not isinstance(row, dict):
            report.rejected["not_an_object"] += 1
            continue
        start = parse_utc(row.get("startTime"))
        publish = parse_utc(row.get("publishTime"))
        mw = _parse_mw(row.get("generation"))
        if start is None or publish is None:
            report.rejected["invalid_timestamp"] += 1
            continue
        if mw is None:
            report.rejected["missing_generation"] += 1
            continue
        by_key.setdefault((publish, start), []).append(mw)

    out: List[ForecastRecord] = []
    for key in sorted(by_key):
        values = by_key[key]
        if len(values) > 1:
            report.duplicates_removed += len(values) - 1
            if len(set(values)) > 1:
                report.conflicting_duplicates += 1
        # Identical duplicates are common at chunk boundaries; conflicting ones are
        # resolved deterministically (largest value) and counted above.
        out.append(ForecastRecord(key[0], key[1], max(values)))
    report.accepted = len(out)
    return out, report
