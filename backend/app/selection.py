"""Day-ahead decision cutoffs and look-ahead-free forecast selection.

Definitions (all documented in the Methodology page):

* Delivery day D: a UK settlement date, i.e. 00:00 to 24:00 Europe/London.
* Decision cutoff for D: the policy's gate-closure time on D-1, UK local time.
* Eligible publication: a WINDFOR publication whose ``publishTime`` is strictly
  earlier than the cutoff. Anything published at or after the cutoff could not
  have informed the purchase and is never selected.
* Selected forecast for an interval: the value from the latest eligible
  publication that contains a point for that interval.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from .config import UK_TZ, CutoffPolicy
from .normalize import ForecastRecord

HALF_HOUR = timedelta(minutes=30)


def delivery_day_bounds(delivery_date: date) -> Tuple[datetime, datetime]:
    """UTC [start, end) of a UK delivery day. Handles 46/50 half-hour clock-change days."""
    start_local = datetime.combine(delivery_date, datetime.min.time(), tzinfo=UK_TZ)
    end_local = datetime.combine(delivery_date + timedelta(days=1), datetime.min.time(), tzinfo=UK_TZ)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def delivery_intervals(delivery_date: date) -> List[datetime]:
    start, end = delivery_day_bounds(delivery_date)
    out = []
    t = start
    while t < end:
        out.append(t)
        t += HALF_HOUR
    return out


def delivery_date_of(start_utc: datetime) -> date:
    return start_utc.astimezone(UK_TZ).date()


def decision_cutoff(delivery_date: date, policy: CutoffPolicy) -> datetime:
    """UTC instant of the purchasing decision cutoff for a delivery day."""
    local = datetime.combine(delivery_date - timedelta(days=1), policy.local_time, tzinfo=UK_TZ)
    return local.astimezone(timezone.utc)


def is_eligible(publish_time: datetime, cutoff: datetime) -> bool:
    return publish_time < cutoff


@dataclass(frozen=True)
class Selection:
    publish_time: datetime
    generation_mw: float


class ForecastIndex:
    """Forecast publications indexed for fast "latest before cutoff" lookups."""

    def __init__(self, records: Iterable[ForecastRecord]):
        by_pub: Dict[datetime, Dict[datetime, float]] = {}
        for r in records:
            by_pub.setdefault(r.publish_time, {})[r.start_time] = r.generation_mw
        self._points = by_pub
        self.publish_times: List[datetime] = sorted(by_pub)

    def points(self, publish_time: datetime) -> Dict[datetime, float]:
        return self._points.get(publish_time, {})

    def eligible_publications(self, cutoff: datetime) -> List[datetime]:
        """Publish times strictly before the cutoff, latest first."""
        idx = bisect.bisect_left(self.publish_times, cutoff)
        return self.publish_times[:idx][::-1]

    def select(self, start_time: datetime, cutoff: datetime) -> Optional[Selection]:
        """Latest eligible published point for one interval start, or None."""
        for pub in self.eligible_publications(cutoff):
            value = self._points[pub].get(start_time)
            if value is not None:
                return Selection(pub, value)
        return None

    def select_interpolated(self, start_time: datetime, cutoff: datetime) -> Optional[Selection]:
        """Linear interpolation between neighbouring hourly points of one eligible publication.

        Both neighbours must come from the *same* publication so the derived value
        reflects a single forecast vintage.
        """
        before, after = start_time - HALF_HOUR, start_time + HALF_HOUR
        for pub in self.eligible_publications(cutoff):
            pts = self._points[pub]
            if before in pts and after in pts:
                return Selection(pub, (pts[before] + pts[after]) / 2.0)
        return None
