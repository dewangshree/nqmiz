import math
from datetime import date

import pytest

from app.config import CUTOFF_POLICIES
from app.matching import MATCHED, MISSING_ACTUAL, MISSING_BOTH, MISSING_FORECAST, NOT_EVALUATED, match_intervals
from app.metrics import compute_metrics, histogram, quantile
from app.normalize import ForecastRecord, normalize_actuals, normalize_forecasts, parse_utc
from app.selection import ForecastIndex

from .conftest import fuelhh_rows, utc, windfor_rows

N2EX = CUTOFF_POLICIES["n2ex"]


# -- normalisation ----------------------------------------------------------
def test_parse_utc_handles_z_offsets_and_rejects_naive():
    assert parse_utc("2026-01-01T00:30:00Z") == utc(2026, 1, 1, 0, 30)
    assert parse_utc("2026-07-01T01:00:00+01:00") == utc(2026, 7, 1, 0, 0)
    assert parse_utc("2026-01-01T00:30:00") is None
    assert parse_utc("garbage") is None
    assert parse_utc(None) is None


def test_actual_duplicates_resolved_to_latest_revision():
    rows = fuelhh_rows(date(2026, 1, 5), date(2026, 1, 5))
    dup = dict(rows[3], generation=12345, publishTime="2026-01-06T00:00:00Z")
    actuals, report = normalize_actuals(rows + [dup, dict(rows[4])])
    assert len(actuals) == 48
    assert report.duplicates_removed == 2
    assert report.conflicting_duplicates == 1
    assert actuals[3].generation_mw == 12345


def test_invalid_actual_rows_are_rejected_and_counted_never_zeroed():
    base = fuelhh_rows(date(2026, 1, 5), date(2026, 1, 5))[:6]
    bad = [
        dict(base[0], generation=None),
        dict(base[1], generation="12"),
        dict(base[2], startTime="not-a-date"),
        dict(base[3], fuelType="CCGT"),
        dict(base[4], startTime="2026-01-05T02:15:00Z"),
        "not a dict",
        dict(base[5], generation=float("nan")),
    ]
    actuals, report = normalize_actuals(bad)
    assert actuals == []
    assert report.received == 7
    assert report.rejected["missing_generation"] == 3
    assert report.rejected["invalid_timestamp"] == 1
    assert report.rejected["not_wind"] == 1
    assert report.rejected["misaligned_interval"] == 1
    assert report.rejected["not_an_object"] == 1


def test_forecast_identical_duplicates_collapse():
    rows = windfor_rows([utc(2026, 1, 4, 9, 30)], {})
    forecasts, report = normalize_forecasts(rows + rows[:5])
    assert len(forecasts) == 73
    assert report.duplicates_removed == 5
    assert report.conflicting_duplicates == 0


def test_forecast_missing_values_rejected():
    rows = windfor_rows([utc(2026, 1, 4, 9, 30)], {})[:2]
    rows[0]["generation"] = None
    forecasts, report = normalize_forecasts(rows)
    assert len(forecasts) == 1
    assert report.rejected["missing_generation"] == 1


# -- matching ---------------------------------------------------------------
def _setup(actual_rows, forecast_rows):
    actuals, _ = normalize_actuals(actual_rows)
    forecasts, _ = normalize_forecasts(forecast_rows)
    return actuals, ForecastIndex(forecasts)


def test_matching_native_only_evaluates_hourly_points():
    d = date(2026, 1, 10)
    actuals, idx = _setup(
        fuelhh_rows(d, d, mw=8000),
        windfor_rows([utc(2026, 1, 9, 9, 30)], {}, base_mw=9000),
    )
    rows = match_intervals([d], actuals, idx, N2EX, "native")
    assert len(rows) == 48
    assert sum(r.status == MATCHED for r in rows) == 24
    assert sum(r.status == NOT_EVALUATED for r in rows) == 24
    first = rows[0]
    assert first.error_mw == 1000.0
    assert first.forecast_publish_time == utc(2026, 1, 9, 9, 30)
    assert first.horizon_hours == pytest.approx(14.5)


def test_matching_interpolated_covers_all_half_hours():
    d = date(2026, 1, 10)
    actuals, idx = _setup(fuelhh_rows(d, d), windfor_rows([utc(2026, 1, 9, 9, 30)], {}))
    rows = match_intervals([d], actuals, idx, N2EX, "interpolated")
    assert all(r.status == MATCHED for r in rows)
    assert rows[1].forecast_kind == "interpolated"
    assert rows[0].forecast_kind == "published"


def test_matching_never_uses_post_cutoff_publication():
    d = date(2026, 1, 10)
    actuals, idx = _setup(fuelhh_rows(d, d), windfor_rows([utc(2026, 1, 9, 10, 30)], {}))
    rows = match_intervals([d], actuals, idx, N2EX, "native")
    evaluated = [r for r in rows if r.evaluated]
    assert all(r.status == MISSING_FORECAST for r in evaluated)
    assert all(r.forecast_mw is None and r.error_mw is None for r in rows)


def test_matching_reports_missing_actuals_and_both():
    d = date(2026, 1, 10)
    actual_rows = fuelhh_rows(d, d)
    del actual_rows[0]  # 00:00 missing actual, forecast present
    forecast_rows = [r for r in windfor_rows([utc(2026, 1, 9, 9, 30)], {}) if r["startTime"] != "2026-01-10T01:00:00Z"]
    del actual_rows[1]  # 01:00 (index shifts after first delete) -> missing both
    actuals, idx = _setup(actual_rows, forecast_rows)
    rows = {r.start_time: r for r in match_intervals([d], actuals, idx, N2EX, "native")}
    assert rows[utc(2026, 1, 10, 0)].status == MISSING_ACTUAL
    assert rows[utc(2026, 1, 10, 1)].status == MISSING_BOTH
    assert rows[utc(2026, 1, 10, 2)].status == MATCHED


def test_matching_rejects_unknown_alignment():
    with pytest.raises(ValueError):
        match_intervals([], [], ForecastIndex([]), N2EX, "weird")


def test_matching_empty_inputs_produce_explicit_missing_rows():
    rows = match_intervals([date(2026, 1, 10)], [], ForecastIndex([]), N2EX, "native")
    assert len(rows) == 48
    assert {r.status for r in rows} == {MISSING_BOTH, NOT_EVALUATED}


# -- metrics ----------------------------------------------------------------
def test_metrics_known_values():
    # errors: +100, -200, +300, 0
    m = compute_metrics([(1100, 1000), (800, 1000), (1300, 1000), (1000, 1000)])
    assert m.n == 4
    assert m.mae_mw == pytest.approx(150.0)
    assert m.rmse_mw == pytest.approx(math.sqrt((100**2 + 200**2 + 300**2) / 4))
    assert m.bias_mw == pytest.approx(50.0)
    assert m.mean_actual_mw == 1000 and m.mean_forecast_mw == 1050
    assert m.nmae_pct == pytest.approx(15.0)
    assert (m.over_count, m.under_count, m.exact_count) == (2, 1, 1)
    assert m.max_abs_error_mw == 300


def test_metrics_empty_dataset():
    m = compute_metrics([])
    assert m.n == 0 and m.mae_mw is None and m.rmse_mw is None and m.bias_mw is None and m.nmae_pct is None


def test_nmae_suppressed_for_near_zero_actuals():
    m = compute_metrics([(10, 0), (20, 5)])
    assert m.mae_mw == pytest.approx(12.5)
    assert m.nmae_pct is None


def test_quantile_and_histogram():
    assert quantile([1.0, 2.0, 3.0, 4.0], 0.5) == 2.5
    assert quantile([], 0.5) is None
    bins = histogram([-600, -100, 0, 499, 501], 500)
    assert [b["bin_start"] for b in bins] == [-1000, -500, 0, 500]
    assert [b["count"] for b in bins] == [1, 1, 2, 1]
    assert histogram([], 500) == []


def test_forecast_index_record_lookup():
    idx = ForecastIndex([ForecastRecord(utc(2026, 1, 1, 9, 30), utc(2026, 1, 2), 1.0)])
    assert idx.points(utc(2026, 1, 1, 9, 30)) == {utc(2026, 1, 2): 1.0}
    assert idx.eligible_publications(utc(2026, 1, 1, 9, 30)) == []
