"""Live smoke tests against the real Elexon API. Skipped unless RUN_LIVE_TESTS=1."""
import os
from datetime import date

import pytest

from app.config import Settings
from app.elexon_client import ElexonClient
from app.normalize import normalize_actuals, normalize_forecasts

from .conftest import utc

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_TESTS") != "1", reason="set RUN_LIVE_TESTS=1 to call Elexon")


@pytest.fixture
def client():
    c = ElexonClient(Settings())
    yield c
    c.close()


def test_live_fuelhh_one_day(client):
    actuals, report = normalize_actuals(client.fetch_fuelhh_wind(date(2026, 1, 15), date(2026, 1, 15)))
    assert len(actuals) == 48 and not report.rejected


def test_live_windfor_one_day_is_hourly(client):
    forecasts, report = normalize_forecasts(client.fetch_windfor(utc(2026, 1, 14), utc(2026, 1, 15)))
    assert forecasts and not report.rejected
    assert {f.start_time.minute for f in forecasts} == {0}
