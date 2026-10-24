from datetime import date, time

from app.config import CUTOFF_POLICIES, CutoffPolicy
from app.normalize import ForecastRecord
from app.selection import (
    ForecastIndex,
    decision_cutoff,
    delivery_date_of,
    delivery_day_bounds,
    delivery_intervals,
    is_eligible,
)

from .conftest import utc

N2EX = CUTOFF_POLICIES["n2ex"]
EPEX = CUTOFF_POLICIES["epex"]


def test_cutoff_is_previous_day_uk_local_time_in_winter():
    assert decision_cutoff(date(2026, 1, 15), N2EX) == utc(2026, 1, 14, 9, 50)
    assert decision_cutoff(date(2026, 1, 15), EPEX) == utc(2026, 1, 14, 9, 20)


def test_cutoff_converts_bst_to_utc():
    # 09:50 BST on 30 Jun is 08:50 UTC.
    assert decision_cutoff(date(2026, 7, 1), N2EX) == utc(2026, 6, 30, 8, 50)


def test_cutoff_across_month_boundary():
    assert decision_cutoff(date(2026, 1, 2), N2EX) == utc(2026, 1, 1, 9, 50)
    assert decision_cutoff(date(2026, 2, 1), N2EX) == utc(2026, 1, 31, 9, 50)


def test_delivery_day_bounds_and_clock_change_days():
    assert delivery_day_bounds(date(2026, 1, 10)) == (utc(2026, 1, 10), utc(2026, 1, 11))
    assert len(delivery_intervals(date(2026, 1, 10))) == 48
    assert len(delivery_intervals(date(2026, 3, 29))) == 46  # spring forward
    assert len(delivery_intervals(date(2026, 10, 25))) == 50  # fall back
    # 23:30 UTC on 30 Jun is 00:30 BST on 1 Jul.
    assert delivery_date_of(utc(2026, 6, 30, 23, 30)) == date(2026, 7, 1)
    assert delivery_date_of(utc(2026, 1, 31, 23, 30)) == date(2026, 1, 31)


def test_eligibility_is_strictly_before_cutoff():
    cutoff = utc(2026, 1, 14, 9, 50)
    assert is_eligible(utc(2026, 1, 14, 9, 30), cutoff)
    assert not is_eligible(cutoff, cutoff)
    assert not is_eligible(utc(2026, 1, 14, 11, 30), cutoff)


def _index(points):
    return ForecastIndex(ForecastRecord(p, s, v) for p, s, v in points)


def test_selects_latest_publication_before_cutoff_and_ignores_later_ones():
    target = utc(2026, 1, 15, 12)
    idx = _index(
        [
            (utc(2026, 1, 14, 4, 30), target, 1000.0),
            (utc(2026, 1, 14, 9, 30), target, 2000.0),
            (utc(2026, 1, 14, 9, 50), target, 3000.0),  # exactly at cutoff -> ineligible
            (utc(2026, 1, 14, 11, 30), target, 4000.0),  # after cutoff
            (utc(2026, 1, 15, 9, 30), target, 5000.0),  # latest available "now"
        ]
    )
    sel = idx.select(target, decision_cutoff(date(2026, 1, 15), N2EX))
    assert sel.publish_time == utc(2026, 1, 14, 9, 30)
    assert sel.generation_mw == 2000.0
    # The EPEX cutoff (09:20) excludes the 09:30 publication.
    sel = idx.select(target, decision_cutoff(date(2026, 1, 15), EPEX))
    assert sel.publish_time == utc(2026, 1, 14, 4, 30)


def test_falls_back_to_earlier_publication_missing_the_interval():
    target = utc(2026, 1, 15, 12)
    idx = _index(
        [
            (utc(2026, 1, 14, 4, 30), target, 1000.0),
            (utc(2026, 1, 14, 9, 30), utc(2026, 1, 15, 11), 2000.0),  # no point for target
        ]
    )
    sel = idx.select(target, utc(2026, 1, 14, 9, 50))
    assert sel.publish_time == utc(2026, 1, 14, 4, 30)


def test_no_eligible_publication_returns_none():
    target = utc(2026, 1, 15, 12)
    idx = _index([(utc(2026, 1, 14, 11, 30), target, 1000.0)])
    assert idx.select(target, utc(2026, 1, 14, 9, 50)) is None
    assert _index([]).select(target, utc(2026, 1, 14, 9, 50)) is None


def test_interpolation_uses_neighbours_from_a_single_publication():
    pub_a, pub_b = utc(2026, 1, 14, 4, 30), utc(2026, 1, 14, 9, 30)
    idx = _index(
        [
            (pub_a, utc(2026, 1, 15, 12), 1000.0),
            (pub_a, utc(2026, 1, 15, 13), 2000.0),
            (pub_b, utc(2026, 1, 15, 12), 3000.0),  # pub_b lacks the 13:00 neighbour
        ]
    )
    sel = idx.select_interpolated(utc(2026, 1, 15, 12, 30), utc(2026, 1, 14, 9, 50))
    assert sel.publish_time == pub_a
    assert sel.generation_mw == 1500.0


def test_custom_policy_time():
    policy = CutoffPolicy("x", "x", time(0, 0), "", "")
    assert decision_cutoff(date(2026, 1, 2), policy) == utc(2026, 1, 1)
