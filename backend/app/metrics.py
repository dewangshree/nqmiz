"""Forecast error metrics computed over matched (forecast, actual) pairs only.

Error convention: error = forecast - actual (MW). Positive = overforecast.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# nMAE is only reported when mean actual generation is meaningfully above zero;
# dividing by a near-zero mean would produce a misleadingly huge percentage.
NMAE_MIN_MEAN_ACTUAL_MW = 100.0


@dataclass(frozen=True)
class ErrorMetrics:
    n: int
    mean_actual_mw: Optional[float]
    mean_forecast_mw: Optional[float]
    mae_mw: Optional[float]
    rmse_mw: Optional[float]
    bias_mw: Optional[float]
    nmae_pct: Optional[float]
    max_abs_error_mw: Optional[float]
    p10_error_mw: Optional[float]
    p50_error_mw: Optional[float]
    p90_error_mw: Optional[float]
    over_count: int
    under_count: int
    exact_count: int


def quantile(sorted_values: Sequence[float], q: float) -> Optional[float]:
    """Linear-interpolated quantile (same as numpy's default method)."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    frac = pos - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def compute_metrics(pairs: Iterable[Tuple[float, float]]) -> ErrorMetrics:
    """``pairs`` are (forecast_mw, actual_mw); non-finite values must be filtered upstream."""
    forecasts: List[float] = []
    actuals: List[float] = []
    for f, a in pairs:
        forecasts.append(f)
        actuals.append(a)
    n = len(forecasts)
    if n == 0:
        return ErrorMetrics(0, None, None, None, None, None, None, None, None, None, None, 0, 0, 0)
    errors = [f - a for f, a in zip(forecasts, actuals)]
    mean_actual = sum(actuals) / n
    mae = sum(abs(e) for e in errors) / n
    sorted_err = sorted(errors)
    return ErrorMetrics(
        n=n,
        mean_actual_mw=mean_actual,
        mean_forecast_mw=sum(forecasts) / n,
        mae_mw=mae,
        rmse_mw=math.sqrt(sum(e * e for e in errors) / n),
        bias_mw=sum(errors) / n,
        nmae_pct=(100.0 * mae / mean_actual) if mean_actual >= NMAE_MIN_MEAN_ACTUAL_MW else None,
        max_abs_error_mw=max(abs(e) for e in errors),
        p10_error_mw=quantile(sorted_err, 0.10),
        p50_error_mw=quantile(sorted_err, 0.50),
        p90_error_mw=quantile(sorted_err, 0.90),
        over_count=sum(1 for e in errors if e > 0),
        under_count=sum(1 for e in errors if e < 0),
        exact_count=sum(1 for e in errors if e == 0),
    )


def histogram(values: Sequence[float], bin_width: float) -> List[Dict[str, float]]:
    """Fixed-width bins aligned to multiples of ``bin_width``."""
    if not values:
        return []
    lo = math.floor(min(values) / bin_width)
    hi = math.floor(max(values) / bin_width)
    counts: Dict[int, int] = {}
    for v in values:
        b = math.floor(v / bin_width)
        counts[b] = counts.get(b, 0) + 1
    return [
        {"bin_start": b * bin_width, "bin_end": (b + 1) * bin_width, "count": counts.get(b, 0)}
        for b in range(lo, hi + 1)
    ]
