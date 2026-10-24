"""Analysis service: source data -> selection -> matching -> aggregates.

Expensive steps (indexing forecasts, matching the whole period) are memoised
per (data version, cutoff policy, alignment). Endpoints then slice the cached
interval list by date, so filter changes never trigger new Elexon requests.
"""
from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from .config import DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST, UK_TZ, CutoffPolicy
from .matching import (
    MATCHED,
    MISSING_ACTUAL,
    MISSING_BOTH,
    MISSING_FORECAST,
    IntervalResult,
    date_range,
    match_intervals,
)
from .metrics import ErrorMetrics, compute_metrics, histogram
from .repository import SourceData, SourceRepository
from .selection import ForecastIndex, decision_cutoff, delivery_day_bounds

HORIZON_BUCKETS: List[Tuple[str, float, float]] = [
    ("< 18 h", 0, 18),
    ("18–24 h", 18, 24),
    ("24–30 h", 24, 30),
    ("30–36 h", 30, 36),
    ("≥ 36 h", 36, 1e9),
]
ERROR_BIN_MW = 500.0


@dataclass(frozen=True)
class Coverage:
    delivery_days: int
    total_half_hours: int
    evaluated_intervals: int
    matched: int
    missing_actual: int
    missing_forecast: int
    missing_both: int
    actual_half_hours_available: int
    actual_energy_gwh: Optional[float]

    @property
    def match_rate(self) -> Optional[float]:
        return self.matched / self.evaluated_intervals if self.evaluated_intervals else None


def pairs(intervals: List[IntervalResult]) -> List[Tuple[float, float]]:
    return [(i.forecast_mw, i.actual_mw) for i in intervals if i.status == MATCHED]  # type: ignore[misc]


def coverage(intervals: List[IntervalResult]) -> Coverage:
    evaluated = [i for i in intervals if i.evaluated]
    with_actual = [i.actual_mw for i in intervals if i.actual_mw is not None]
    return Coverage(
        delivery_days=len({i.delivery_date for i in intervals}),
        total_half_hours=len(intervals),
        evaluated_intervals=len(evaluated),
        matched=sum(1 for i in evaluated if i.status == MATCHED),
        missing_actual=sum(1 for i in evaluated if i.status == MISSING_ACTUAL),
        missing_forecast=sum(1 for i in evaluated if i.status == MISSING_FORECAST),
        missing_both=sum(1 for i in evaluated if i.status == MISSING_BOTH),
        actual_half_hours_available=len(with_actual),
        # FUELHH values are half-hour average MW, so MW x 0.5 h = MWh for that half-hour.
        actual_energy_gwh=(sum(with_actual) * 0.5 / 1000.0) if with_actual else None,
    )


class AnalysisService:
    def __init__(self, repository: SourceRepository):
        self._repo = repository
        self._lock = threading.Lock()
        self._index_cache: Dict[str, ForecastIndex] = {}
        self._match_cache: Dict[Tuple[str, str, str], List[IntervalResult]] = {}

    def source(self) -> SourceData:
        return self._repo.get()

    def refresh(self) -> SourceData:
        data = self._repo.get(force_refresh=True)
        with self._lock:
            self._index_cache.clear()
            self._match_cache.clear()
        return data

    def index(self) -> ForecastIndex:
        data = self.source()
        with self._lock:
            idx = self._index_cache.get(data.version)
            if idx is None:
                self._index_cache.clear()
                idx = ForecastIndex(data.forecasts)
                self._index_cache[data.version] = idx
            return idx

    def intervals(self, policy: CutoffPolicy, alignment: str) -> List[IntervalResult]:
        data = self.source()
        idx = self.index()
        key = (data.version, policy.id, alignment)
        with self._lock:
            cached = self._match_cache.get(key)
        if cached is not None:
            return cached
        result = match_intervals(
            date_range(DELIVERY_DATE_FIRST, DELIVERY_DATE_LAST), data.actuals, idx, policy, alignment
        )
        with self._lock:
            # Drop entries for older data versions.
            for k in [k for k in self._match_cache if k[0] != data.version]:
                del self._match_cache[k]
            self._match_cache[key] = result
        return result

    def intervals_between(self, policy: CutoffPolicy, alignment: str, start: date, end: date) -> List[IntervalResult]:
        return [i for i in self.intervals(policy, alignment) if start <= i.delivery_date <= end]

    # -- aggregates -------------------------------------------------------
    @staticmethod
    def daily(intervals: List[IntervalResult]) -> List[Tuple[date, ErrorMetrics, Coverage, List[datetime]]]:
        by_day: Dict[date, List[IntervalResult]] = defaultdict(list)
        for i in intervals:
            by_day[i.delivery_date].append(i)
        out = []
        for d in sorted(by_day):
            rows = by_day[d]
            pubs = sorted({i.forecast_publish_time for i in rows if i.forecast_publish_time is not None})
            out.append((d, compute_metrics(pairs(rows)), coverage(rows), pubs))
        return out

    @staticmethod
    def by_local_hour(intervals: List[IntervalResult]) -> List[Tuple[int, ErrorMetrics]]:
        buckets: Dict[int, List[IntervalResult]] = defaultdict(list)
        for i in intervals:
            buckets[i.start_time.astimezone(UK_TZ).hour].append(i)
        return [(h, compute_metrics(pairs(buckets.get(h, [])))) for h in range(24)]

    @staticmethod
    def by_horizon(intervals: List[IntervalResult]) -> List[Tuple[str, float, float, ErrorMetrics]]:
        out = []
        for label, lo, hi in HORIZON_BUCKETS:
            rows = [i for i in intervals if i.status == MATCHED and lo <= (i.horizon_hours or 0) < hi]
            out.append((label, lo, hi, compute_metrics(pairs(rows))))
        return out

    @staticmethod
    def error_histogram(intervals: List[IntervalResult]):
        return histogram([i.error_mw for i in intervals if i.error_mw is not None], ERROR_BIN_MW)

    def hindsight_benchmark(
        self, intervals: List[IntervalResult]
    ) -> Tuple[ErrorMetrics, ErrorMetrics]:
        """Day-ahead selection vs the latest forecast published before each interval began.

        The benchmark is NOT available at decision time; it only shows how much
        forecasts improved after the cutoff. Both metrics use identical intervals.
        """
        idx = self.index()
        day_ahead: List[Tuple[float, float]] = []
        latest: List[Tuple[float, float]] = []
        for i in intervals:
            if i.status != MATCHED or i.forecast_kind != "published":
                continue
            sel = idx.select(i.start_time, i.start_time)
            if sel is None:
                continue
            day_ahead.append((i.forecast_mw, i.actual_mw))  # type: ignore[arg-type]
            latest.append((sel.generation_mw, i.actual_mw))  # type: ignore[arg-type]
        return compute_metrics(day_ahead), compute_metrics(latest)

    def publication_history(
        self, policy: CutoffPolicy, delivery_date: date
    ) -> Tuple[datetime, List[dict], Dict[datetime, Optional[float]]]:
        """Every forecast point for one delivery day, from every publication issued before that point's interval began."""
        data = self.source()
        idx = self.index()
        cutoff = decision_cutoff(delivery_date, policy)
        day_start, day_end = delivery_day_bounds(delivery_date)
        actual_by_start = {a.start_time: a.generation_mw for a in data.actuals if day_start <= a.start_time < day_end}
        selected_by_start = {
            i.start_time: i.forecast_publish_time
            for i in self.intervals(policy, "native")
            if i.delivery_date == delivery_date and i.forecast_kind == "published"
        }
        rows = []
        for pub in idx.publish_times:
            if pub >= day_end:
                break
            for start, mw in idx.points(pub).items():
                # Points at or after publication only: earlier points are not forecasts.
                if not (day_start <= start < day_end) or start <= pub:
                    continue
                actual = actual_by_start.get(start)
                rows.append(
                    {
                        "publish_time": pub,
                        "start_time": start,
                        "forecast_mw": mw,
                        "eligible": pub < cutoff,
                        "selected": selected_by_start.get(start) == pub,
                        "horizon_hours": (start - pub).total_seconds() / 3600.0,
                        "actual_mw": actual,
                        "error_mw": (mw - actual) if actual is not None else None,
                    }
                )
        rows.sort(key=lambda r: (r["start_time"], r["publish_time"]))
        actual_series = {}
        t = day_start
        while t < day_end:
            actual_series[t] = actual_by_start.get(t)
            t += timedelta(minutes=30)
        return cutoff, rows, actual_series
