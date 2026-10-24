"""Pydantic response contracts. These are decoupled from Elexon's field names."""
from __future__ import annotations

from datetime import date, datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    error: str
    detail: str


class MetricsOut(BaseModel):
    n: int = Field(description="Matched forecast/actual pairs used for every metric below")
    mean_actual_mw: Optional[float]
    mean_forecast_mw: Optional[float]
    mae_mw: Optional[float]
    rmse_mw: Optional[float]
    bias_mw: Optional[float] = Field(description="Mean of forecast - actual. Positive = overforecast")
    nmae_pct: Optional[float] = Field(description="100 x MAE / mean actual; null if mean actual < 100 MW")
    max_abs_error_mw: Optional[float]
    p10_error_mw: Optional[float]
    p50_error_mw: Optional[float]
    p90_error_mw: Optional[float]
    over_count: int
    under_count: int
    exact_count: int


class CoverageOut(BaseModel):
    delivery_days: int
    total_half_hours: int
    evaluated_intervals: int
    matched: int
    missing_actual: int
    missing_forecast: int
    missing_both: int
    match_rate: Optional[float]
    actual_half_hours_available: int
    actual_energy_gwh: Optional[float] = Field(description="Sum of FUELHH half-hour average MW x 0.5 h, all half-hours")


class CutoffPolicyOut(BaseModel):
    id: str
    label: str
    local_time: str
    rationale: str
    source_url: str


class AlignmentOut(BaseModel):
    id: str
    description: str


class SourceInfoOut(BaseModel):
    dataset: str
    endpoint: str
    params: Dict[str, str]
    fetched_at: datetime
    from_cache: bool
    stale: bool
    rows_received: int


class ContextOut(BaseModel):
    start: date
    end: date
    cutoff: CutoffPolicyOut
    alignment: AlignmentOut
    sources: List[SourceInfoOut]


class DailyOut(BaseModel):
    delivery_date: date
    decision_date: date
    cutoff_utc: datetime
    selected_publications: List[datetime]
    metrics: MetricsOut
    coverage: CoverageOut


class OverviewResponse(BaseModel):
    context: ContextOut
    metrics: MetricsOut
    coverage: CoverageOut
    daily: List[DailyOut]
    insights: List[str]


class IntervalOut(BaseModel):
    start_time: datetime
    delivery_date: date
    settlement_period: int
    cutoff_utc: datetime
    actual_mw: Optional[float]
    forecast_mw: Optional[float]
    forecast_kind: Optional[str]
    forecast_publish_time: Optional[datetime]
    horizon_hours: Optional[float]
    error_mw: Optional[float]
    status: str


class SeriesResponse(BaseModel):
    context: ContextOut
    metrics: MetricsOut
    coverage: CoverageOut
    intervals: List[IntervalOut]


class HourMetricsOut(BaseModel):
    hour_local: int
    metrics: MetricsOut


class HorizonMetricsOut(BaseModel):
    label: str
    min_hours: float
    max_hours: Optional[float]
    metrics: MetricsOut


class HistogramBinOut(BaseModel):
    bin_start: float
    bin_end: float
    count: int


class BenchmarkOut(BaseModel):
    description: str
    day_ahead: MetricsOut
    latest_before_delivery: MetricsOut


class AccuracyResponse(BaseModel):
    context: ContextOut
    metrics: MetricsOut
    coverage: CoverageOut
    daily: List[DailyOut]
    by_hour: List[HourMetricsOut]
    by_horizon: List[HorizonMetricsOut]
    error_histogram: List[HistogramBinOut]
    largest_errors: List[IntervalOut]
    benchmark: BenchmarkOut


class PublicationRowOut(BaseModel):
    publish_time: datetime
    start_time: datetime
    forecast_mw: float
    eligible: bool
    selected: bool
    horizon_hours: float
    actual_mw: Optional[float]
    error_mw: Optional[float]


class ActualPointOut(BaseModel):
    start_time: datetime
    actual_mw: Optional[float]


class PublicationsResponse(BaseModel):
    delivery_date: date
    decision_date: date
    cutoff_utc: datetime
    cutoff: CutoffPolicyOut
    publication_count: int
    eligible_publication_count: int
    rows: List[PublicationRowOut]
    actuals: List[ActualPointOut]
    sources: List[SourceInfoOut]


class QualityOut(BaseModel):
    received: int
    accepted: int
    rejected: Dict[str, int]
    duplicates_removed: int
    conflicting_duplicates: int


class MetaResponse(BaseModel):
    decision_date_first: date
    decision_date_last: date
    delivery_date_first: date
    delivery_date_last: date
    timezone: str
    cutoff_policies: List[CutoffPolicyOut]
    default_cutoff: str
    alignments: List[AlignmentOut]
    default_alignment: str
    sources: List[SourceInfoOut]
    actual_quality: QualityOut
    forecast_quality: QualityOut
    forecast_publication_count: int
    forecast_publication_times_local: List[str] = Field(description="Distinct HH:MM UK publication times observed")
    forecast_point_spacing_minutes: List[int]


class HealthResponse(BaseModel):
    status: str
    data_loaded: bool
    time: datetime
