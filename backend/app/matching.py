"""Pair each delivery half-hour with its actual outturn and its selected forecast.

The list of expected intervals comes from the calendar, not from the data, so
missing actuals or forecasts show up as explicit statuses instead of vanishing.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional

from .config import CutoffPolicy
from .normalize import ActualRecord
from .selection import ForecastIndex, decision_cutoff, delivery_intervals

MATCHED = "matched"
MISSING_ACTUAL = "missing_actual"
MISSING_FORECAST = "missing_forecast"
MISSING_BOTH = "missing_both"
NOT_EVALUATED = "not_evaluated"  # :30 half-hour in native alignment mode


@dataclass(frozen=True)
class IntervalResult:
    start_time: datetime
    delivery_date: date
    settlement_period: int
    cutoff: datetime
    actual_mw: Optional[float]
    forecast_mw: Optional[float]
    forecast_kind: Optional[str]  # "published" | "interpolated"
    forecast_publish_time: Optional[datetime]
    evaluated: bool
    status: str

    @property
    def error_mw(self) -> Optional[float]:
        if self.status != MATCHED:
            return None
        return self.forecast_mw - self.actual_mw  # type: ignore[operator]

    @property
    def horizon_hours(self) -> Optional[float]:
        if self.forecast_publish_time is None:
            return None
        return (self.start_time - self.forecast_publish_time).total_seconds() / 3600.0


def _status(actual: Optional[float], forecast: Optional[float]) -> str:
    if actual is None and forecast is None:
        return MISSING_BOTH
    if actual is None:
        return MISSING_ACTUAL
    if forecast is None:
        return MISSING_FORECAST
    return MATCHED


def match_intervals(
    delivery_dates: Iterable[date],
    actuals: Iterable[ActualRecord],
    index: ForecastIndex,
    policy: CutoffPolicy,
    alignment: str,
) -> List[IntervalResult]:
    if alignment not in ("native", "interpolated"):
        raise ValueError(f"Unknown alignment mode: {alignment}")
    actual_by_start: Dict[datetime, float] = {a.start_time: a.generation_mw for a in actuals}
    out: List[IntervalResult] = []
    for d in delivery_dates:
        cutoff = decision_cutoff(d, policy)
        for period, start in enumerate(delivery_intervals(d), start=1):
            actual = actual_by_start.get(start)
            on_the_hour = start.minute == 0
            evaluated = on_the_hour or alignment == "interpolated"
            selection = None
            kind = None
            if on_the_hour:
                selection = index.select(start, cutoff)
                kind = "published" if selection else None
            elif alignment == "interpolated":
                selection = index.select_interpolated(start, cutoff)
                kind = "interpolated" if selection else None
            forecast = selection.generation_mw if selection else None
            status = _status(actual, forecast) if evaluated else NOT_EVALUATED
            out.append(
                IntervalResult(
                    start_time=start,
                    delivery_date=d,
                    settlement_period=period,
                    cutoff=cutoff,
                    actual_mw=actual,
                    forecast_mw=forecast,
                    forecast_kind=kind,
                    forecast_publish_time=selection.publish_time if selection else None,
                    evaluated=evaluated,
                    status=status,
                )
            )
    return out


def date_range(first: date, last: date) -> List[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]
