"""HTTP routes. Routes validate inputs, call the analysis service and map results to schemas."""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request

from .analysis import AnalysisService, Coverage, coverage, pairs
from .config import (
    ALIGNMENT_MODES,
    CUTOFF_POLICIES,
    DECISION_DATE_FIRST,
    DECISION_DATE_LAST,
    DEFAULT_ALIGNMENT,
    DEFAULT_CUTOFF_POLICY,
    DELIVERY_DATE_FIRST,
    DELIVERY_DATE_LAST,
    UK_TZ,
    CutoffPolicy,
)
from .matching import IntervalResult
from .metrics import ErrorMetrics, compute_metrics
from .repository import SourceInfo
from .schemas import (
    AccuracyResponse,
    ActualPointOut,
    AlignmentOut,
    BenchmarkOut,
    ContextOut,
    CoverageOut,
    CutoffPolicyOut,
    DailyOut,
    HealthResponse,
    HistogramBinOut,
    HorizonMetricsOut,
    HourMetricsOut,
    IntervalOut,
    MetaResponse,
    MetricsOut,
    OverviewResponse,
    PublicationRowOut,
    PublicationsResponse,
    QualityOut,
    SeriesResponse,
    SourceInfoOut,
)

router = APIRouter(prefix="/api")


class InvalidRequest(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def get_service(request: Request) -> AnalysisService:
    return request.app.state.service


# -- parameter parsing ----------------------------------------------------
def _policy(cutoff: str) -> CutoffPolicy:
    policy = CUTOFF_POLICIES.get(cutoff)
    if policy is None:
        raise InvalidRequest(f"Unknown cutoff policy '{cutoff}'. Valid values: {', '.join(CUTOFF_POLICIES)}")
    return policy


def _alignment(alignment: str) -> str:
    if alignment not in ALIGNMENT_MODES:
        raise InvalidRequest(f"Unknown alignment '{alignment}'. Valid values: {', '.join(ALIGNMENT_MODES)}")
    return alignment


def _in_period(d: date, name: str) -> date:
    if not (DELIVERY_DATE_FIRST <= d <= DELIVERY_DATE_LAST):
        raise InvalidRequest(
            f"{name} {d.isoformat()} is outside the analysis period "
            f"({DELIVERY_DATE_FIRST.isoformat()} to {DELIVERY_DATE_LAST.isoformat()} delivery dates)."
        )
    return d


def _range(start: Optional[date], end: Optional[date]):
    s = _in_period(start, "start") if start else DELIVERY_DATE_FIRST
    e = _in_period(end, "end") if end else DELIVERY_DATE_LAST
    if s > e:
        raise InvalidRequest("start must be on or before end.")
    return s, e


StartQ = Query(None, description="First delivery date (UK settlement date), inclusive")
EndQ = Query(None, description="Last delivery date (UK settlement date), inclusive")
CutoffQ = Query(DEFAULT_CUTOFF_POLICY, description="Decision cutoff policy: " + ", ".join(CUTOFF_POLICIES))
AlignQ = Query(DEFAULT_ALIGNMENT, description="Half-hour alignment: " + ", ".join(ALIGNMENT_MODES))


# -- mappers --------------------------------------------------------------
def _metrics(m: ErrorMetrics) -> MetricsOut:
    return MetricsOut(**asdict(m))


def _coverage(c: Coverage) -> CoverageOut:
    return CoverageOut(**asdict(c), match_rate=c.match_rate)


def _policy_out(p: CutoffPolicy) -> CutoffPolicyOut:
    return CutoffPolicyOut(
        id=p.id, label=p.label, local_time=p.local_time.strftime("%H:%M"), rationale=p.rationale, source_url=p.source_url
    )


def _sources(infos: List[SourceInfo]) -> List[SourceInfoOut]:
    return [SourceInfoOut(**asdict(i)) for i in infos]


def _context(service: AnalysisService, policy: CutoffPolicy, alignment: str, s: date, e: date) -> ContextOut:
    return ContextOut(
        start=s,
        end=e,
        cutoff=_policy_out(policy),
        alignment=AlignmentOut(id=alignment, description=ALIGNMENT_MODES[alignment]),
        sources=_sources(service.source().sources),
    )


def _interval(i: IntervalResult) -> IntervalOut:
    return IntervalOut(
        start_time=i.start_time,
        delivery_date=i.delivery_date,
        settlement_period=i.settlement_period,
        cutoff_utc=i.cutoff,
        actual_mw=i.actual_mw,
        forecast_mw=i.forecast_mw,
        forecast_kind=i.forecast_kind,
        forecast_publish_time=i.forecast_publish_time,
        horizon_hours=i.horizon_hours,
        error_mw=i.error_mw,
        status=i.status,
    )


def _daily(service: AnalysisService, intervals: List[IntervalResult]) -> List[DailyOut]:
    out = []
    for d, m, c, pubs in service.daily(intervals):
        cutoff = next(i.cutoff for i in intervals if i.delivery_date == d)
        out.append(
            DailyOut(
                delivery_date=d,
                decision_date=d - timedelta(days=1),
                cutoff_utc=cutoff,
                selected_publications=pubs,
                metrics=_metrics(m),
                coverage=_coverage(c),
            )
        )
    return out


def _fmt_mw(v: float) -> str:
    return f"{v:,.0f} MW"


def build_insights(m: ErrorMetrics, cov: Coverage, daily: List[DailyOut]) -> List[str]:
    """Plain-language observations derived only from the computed results."""
    if m.n == 0:
        return ["No matched forecast/actual intervals are available for the selected period."]
    out = [
        f"Across {m.n:,} matched intervals the selected day-ahead forecast averaged "
        f"{_fmt_mw(m.mean_forecast_mw)} against an actual average of {_fmt_mw(m.mean_actual_mw)}."
    ]
    direction = "overforecast" if m.bias_mw > 0 else "underforecast"
    share = (m.over_count if m.bias_mw > 0 else m.under_count) / m.n
    out.append(
        f"On average the forecast {direction} by {_fmt_mw(abs(m.bias_mw))} "
        f"({share:.0%} of intervals were {direction}). Typical absolute error (MAE) was {_fmt_mw(m.mae_mw)}."
    )
    out.append(
        f"80% of interval errors fell between {m.p10_error_mw:+,.0f} MW and {m.p90_error_mw:+,.0f} MW; "
        f"the largest single miss was {_fmt_mw(m.max_abs_error_mw)}."
    )
    scored = [d for d in daily if d.metrics.n > 0]
    if len(scored) > 1:
        worst = max(scored, key=lambda d: d.metrics.mae_mw)
        best = min(scored, key=lambda d: d.metrics.mae_mw)
        out.append(
            f"Daily MAE ranged from {_fmt_mw(best.metrics.mae_mw)} ({best.delivery_date:%a %d %b}) "
            f"to {_fmt_mw(worst.metrics.mae_mw)} ({worst.delivery_date:%a %d %b})."
        )
    unmatched = cov.evaluated_intervals - cov.matched
    if unmatched:
        out.append(
            f"{unmatched:,} of {cov.evaluated_intervals:,} evaluated intervals could not be matched "
            f"({cov.missing_actual} missing actual, {cov.missing_forecast} missing forecast, "
            f"{cov.missing_both} missing both) and are excluded from all metrics."
        )
    else:
        out.append(f"All {cov.evaluated_intervals:,} evaluated intervals had both a valid forecast and actual.")
    return out


# -- endpoints ------------------------------------------------------------
@router.get("/health", response_model=HealthResponse)
def health(request: Request):
    return HealthResponse(
        status="ok", data_loaded=request.app.state.repository.loaded, time=datetime.now(timezone.utc)
    )


@router.get("/meta", response_model=MetaResponse)
def meta(service: AnalysisService = Depends(get_service)):
    data = service.source()
    idx = service.index()
    local_times = sorted({p.astimezone(UK_TZ).strftime("%H:%M") for p in idx.publish_times})
    spacings = set()
    for pub in idx.publish_times:
        starts = sorted(idx.points(pub))
        spacings.update(int((b - a).total_seconds() // 60) for a, b in zip(starts, starts[1:]))
    return MetaResponse(
        decision_date_first=DECISION_DATE_FIRST,
        decision_date_last=DECISION_DATE_LAST,
        delivery_date_first=DELIVERY_DATE_FIRST,
        delivery_date_last=DELIVERY_DATE_LAST,
        timezone="Europe/London",
        cutoff_policies=[_policy_out(p) for p in CUTOFF_POLICIES.values()],
        default_cutoff=DEFAULT_CUTOFF_POLICY,
        alignments=[AlignmentOut(id=k, description=v) for k, v in ALIGNMENT_MODES.items()],
        default_alignment=DEFAULT_ALIGNMENT,
        sources=_sources(data.sources),
        actual_quality=QualityOut(**data.actual_quality.as_dict()),
        forecast_quality=QualityOut(**data.forecast_quality.as_dict()),
        forecast_publication_count=len(idx.publish_times),
        forecast_publication_times_local=local_times,
        forecast_point_spacing_minutes=sorted(spacings),
    )


@router.get("/overview", response_model=OverviewResponse)
def overview(
    start: Optional[date] = StartQ,
    end: Optional[date] = EndQ,
    cutoff: str = CutoffQ,
    alignment: str = AlignQ,
    service: AnalysisService = Depends(get_service),
):
    policy, align = _policy(cutoff), _alignment(alignment)
    s, e = _range(start, end)
    rows = service.intervals_between(policy, align, s, e)
    m, cov = compute_metrics(pairs(rows)), coverage(rows)
    daily = _daily(service, rows)
    return OverviewResponse(
        context=_context(service, policy, align, s, e),
        metrics=_metrics(m),
        coverage=_coverage(cov),
        daily=daily,
        insights=build_insights(m, cov, daily),
    )


@router.get("/forecast-vs-actual", response_model=SeriesResponse)
def forecast_vs_actual(
    start: Optional[date] = StartQ,
    end: Optional[date] = EndQ,
    cutoff: str = CutoffQ,
    alignment: str = AlignQ,
    service: AnalysisService = Depends(get_service),
):
    policy, align = _policy(cutoff), _alignment(alignment)
    s, e = _range(start, end)
    rows = service.intervals_between(policy, align, s, e)
    return SeriesResponse(
        context=_context(service, policy, align, s, e),
        metrics=_metrics(compute_metrics(pairs(rows))),
        coverage=_coverage(coverage(rows)),
        intervals=[_interval(i) for i in rows],
    )


@router.get("/accuracy", response_model=AccuracyResponse)
def accuracy(
    start: Optional[date] = StartQ,
    end: Optional[date] = EndQ,
    cutoff: str = CutoffQ,
    alignment: str = AlignQ,
    service: AnalysisService = Depends(get_service),
):
    policy, align = _policy(cutoff), _alignment(alignment)
    s, e = _range(start, end)
    rows = service.intervals_between(policy, align, s, e)
    day_ahead, latest = service.hindsight_benchmark(rows)
    largest = sorted((i for i in rows if i.error_mw is not None), key=lambda i: abs(i.error_mw), reverse=True)[:10]
    return AccuracyResponse(
        context=_context(service, policy, align, s, e),
        metrics=_metrics(compute_metrics(pairs(rows))),
        coverage=_coverage(coverage(rows)),
        daily=_daily(service, rows),
        by_hour=[HourMetricsOut(hour_local=h, metrics=_metrics(m)) for h, m in service.by_local_hour(rows)],
        by_horizon=[
            HorizonMetricsOut(label=label, min_hours=lo, max_hours=hi if hi < 1e8 else None, metrics=_metrics(m))
            for label, lo, hi, m in service.by_horizon(rows)
        ],
        error_histogram=[HistogramBinOut(**b) for b in service.error_histogram(rows)],
        largest_errors=[_interval(i) for i in largest],
        benchmark=BenchmarkOut(
            description=(
                "Hindsight comparison only: 'latest before delivery' uses the newest WINDFOR publication issued "
                "before each interval began, which was NOT available at the day-ahead cutoff. Both columns use "
                "the same published (non-interpolated) intervals."
            ),
            day_ahead=_metrics(day_ahead),
            latest_before_delivery=_metrics(latest),
        ),
    )


@router.get("/forecast-publications", response_model=PublicationsResponse)
def forecast_publications(
    delivery_date: date = Query(..., alias="date", description="Delivery date (UK settlement date)"),
    cutoff: str = CutoffQ,
    service: AnalysisService = Depends(get_service),
):
    policy = _policy(cutoff)
    d = _in_period(delivery_date, "date")
    cutoff_utc, rows, actuals = service.publication_history(policy, d)
    pubs = {r["publish_time"] for r in rows}
    return PublicationsResponse(
        delivery_date=d,
        decision_date=d - timedelta(days=1),
        cutoff_utc=cutoff_utc,
        cutoff=_policy_out(policy),
        publication_count=len(pubs),
        eligible_publication_count=sum(1 for p in pubs if p < cutoff_utc),
        rows=[PublicationRowOut(**r) for r in rows],
        actuals=[ActualPointOut(start_time=t, actual_mw=v) for t, v in actuals.items()],
        sources=_sources(service.source().sources),
    )


@router.post("/refresh", response_model=MetaResponse)
def refresh(service: AnalysisService = Depends(get_service)):
    """Force re-download of source data from Elexon (falls back to stale cache on failure)."""
    service.refresh()
    return meta(service)
