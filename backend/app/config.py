"""Application settings and the fixed analysis methodology constants.

Everything that defines *how* the analysis is done (period, cutoff policies,
time zone) lives here so it can be documented and tested in one place.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, time
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

# GB market time. Settlement dates, delivery days and gate-closure times are all
# defined in UK local time (GMT in winter, BST in summer). All internal
# timestamps are timezone-aware UTC; conversion happens only at day boundaries.
UK_TZ = ZoneInfo("Europe/London")

# Analysis period: purchasing decisions made during January 2026.
# A decision on day D-1 buys electricity for delivery day D, so decisions made
# 1-31 Jan 2026 cover delivery days 2 Jan - 1 Feb 2026 (UK settlement dates).
DECISION_DATE_FIRST = date(2026, 1, 1)
DECISION_DATE_LAST = date(2026, 1, 31)
DELIVERY_DATE_FIRST = date(2026, 1, 2)
DELIVERY_DATE_LAST = date(2026, 2, 1)


@dataclass(frozen=True)
class CutoffPolicy:
    """A day-ahead decision cutoff: a UK local time on the day before delivery."""

    id: str
    label: str
    local_time: time
    rationale: str
    source_url: str


CUTOFF_POLICIES: Dict[str, CutoffPolicy] = {
    "n2ex": CutoffPolicy(
        id="n2ex",
        label="N2EX GB day-ahead auction gate closure (09:50 UK, D-1)",
        local_time=time(9, 50),
        rationale=(
            "Nord Pool's N2EX GB day-ahead auction closes at 09:50 UK time on the day "
            "before delivery (moved from 11:00 after the UK left the EU internal energy "
            "market). Bids must be submitted by then, so only forecasts published "
            "strictly before 09:50 could inform the purchase."
        ),
        source_url="https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-day-ahead-gb-auction",
    ),
    "epex": CutoffPolicy(
        id="epex",
        label="EPEX SPOT GB day-ahead auction gate closure (09:20 UK, D-1)",
        local_time=time(9, 20),
        rationale=(
            "EPEX SPOT's GB hourly day-ahead auction closes at 10:20 CET (09:20 UK time) "
            "on the day before delivery. This earlier cutoff excludes the 09:30 WINDFOR "
            "publication that the N2EX cutoff admits."
        ),
        source_url="https://www.epexspot.com/en/market-results",
    ),
}
DEFAULT_CUTOFF_POLICY = "n2ex"

# WINDFOR publishes hourly forecast points while FUELHH reports half-hours.
ALIGNMENT_MODES: Dict[str, str] = {
    "native": (
        "Only delivery half-hours that start on the hour are evaluated, because WINDFOR "
        "publishes a forecast point for those start times. No values are derived."
    ),
    "interpolated": (
        "All 48 half-hours are evaluated. Half-hours starting at :30 receive the linear "
        "interpolation of the two neighbouring hourly points from the same selected "
        "publication. These values are derived, not published by Elexon."
    ),
}
DEFAULT_ALIGNMENT = "native"


def _env_list(name: str, default: str) -> List[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    elexon_base_url: str = field(
        default_factory=lambda: os.getenv("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")
    )
    timeout_seconds: float = field(default_factory=lambda: float(os.getenv("ELEXON_TIMEOUT_SECONDS", "20")))
    max_retries: int = field(default_factory=lambda: int(os.getenv("ELEXON_MAX_RETRIES", "3")))
    cache_dir: Path = field(
        default_factory=lambda: Path(os.getenv("CACHE_DIR", str(Path(__file__).resolve().parent.parent / ".cache")))
    )
    cache_ttl_hours: float = field(default_factory=lambda: float(os.getenv("CACHE_TTL_HOURS", "24")))
    cors_origins: List[str] = field(
        default_factory=lambda: _env_list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )
    # Optional regex for additional allowed origins, e.g. Vercel preview deployments.
    cors_origin_regex: Optional[str] = field(default_factory=lambda: os.getenv("CORS_ORIGIN_REGEX") or None)
    frontend_url: str = field(default_factory=lambda: os.getenv("FRONTEND_URL", "http://localhost:5173/"))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))


def get_settings() -> Settings:
    return Settings()
