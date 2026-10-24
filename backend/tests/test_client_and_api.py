import json
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from app.elexon_client import ElexonClient, ElexonError
from app.main import create_app

from .conftest import FakeClient, utc


# -- Elexon client ---------------------------------------------------------
def _client(settings, handler, sleeps=None):
    sleeps = sleeps if sleeps is not None else []
    return ElexonClient(settings, transport=httpx.MockTransport(handler), sleep=sleeps.append)


def test_client_parses_bare_array_and_sends_settlement_params(settings):
    seen = []

    def handler(request):
        seen.append(request.url)
        return httpx.Response(200, json=[{"a": 1}])

    rows = _client(settings, handler).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 2, 1))
    assert rows == [{"a": 1}]
    q = seen[0].params
    assert q["settlementDateFrom"] == "2026-01-02" and q["settlementDateTo"] == "2026-02-01"
    assert q["fuelType"] == "WIND"
    assert "publishDateTimeFrom" not in q  # never combined with settlement-date filters


def test_client_accepts_wrapped_data_payload(settings):
    rows = _client(settings, lambda r: httpx.Response(200, json={"data": [{"x": 1}]})).fetch_fuelhh_wind(
        date(2026, 1, 2), date(2026, 1, 2)
    )
    assert rows == [{"x": 1}]


def test_client_does_not_retry_400(settings):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(400, json={"title": "bad"})

    with pytest.raises(ElexonError) as exc:
        _client(settings, handler).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))
    assert exc.value.status == 400 and not exc.value.retryable
    assert len(calls) == 1


@pytest.mark.parametrize("status", [429, 500, 503])
def test_client_retries_transient_errors_with_backoff(settings, status):
    responses = [httpx.Response(status), httpx.Response(status), httpx.Response(200, json=[])]
    sleeps = []
    rows = _client(settings, lambda r: responses.pop(0), sleeps).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))
    assert rows == []
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0] * 1.2


def test_client_gives_up_after_bounded_retries(settings):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(500)

    with pytest.raises(ElexonError) as exc:
        _client(settings, handler).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))
    assert exc.value.retryable
    assert len(calls) == settings.max_retries + 1


def test_client_retries_timeouts(settings):
    attempts = []

    def handler(request):
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json=[])

    assert _client(settings, handler).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2)) == []
    assert len(attempts) == 2


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"<html>oops</html>"),
        httpx.Response(200, json={"unexpected": True}),
        httpx.Response(200, json="string"),
    ],
)
def test_client_rejects_malformed_payloads(settings, response):
    with pytest.raises(ElexonError):
        _client(settings, lambda r: response).fetch_fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))


def test_windfor_is_chunked_by_publish_time(settings):
    seen = []

    def handler(request):
        seen.append((request.url.params["publishDateTimeFrom"], request.url.params["publishDateTimeTo"]))
        return httpx.Response(200, json=[{"n": len(seen)}])

    rows = _client(settings, handler).fetch_windfor(utc(2025, 12, 30), utc(2026, 2, 2))
    assert len(seen) == 5  # 34 days in 7-day chunks
    assert seen[0] == ("2025-12-30T00:00:00Z", "2026-01-06T00:00:00Z")
    assert seen[-1][1] == "2026-02-02T00:00:00Z"
    assert len(rows) == 5


# -- API ---------------------------------------------------------------------
@pytest.fixture
def api(settings, period_fixture):
    fake = FakeClient(*period_fixture)
    app = create_app(settings, client_factory=lambda: fake, warm_cache=False)
    with TestClient(app) as client:
        client.fake = fake
        yield client


def test_health(api):
    r = api.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_root_points_to_ui_and_health(api):
    body = api.get("/").json()
    assert body["health"] == "/api/health" and body["ui"].endswith(":5173/")


def test_overview_selects_latest_pre_cutoff_forecast(api):
    body = api.get("/api/overview").json()
    m, cov = body["metrics"], body["coverage"]
    # 31 delivery days x 24 hourly points; the 09:30 publication (+500 MW) must win under N2EX.
    assert m["n"] == 744 and cov["matched"] == 744 and cov["match_rate"] == 1.0
    assert m["bias_mw"] == pytest.approx(500.0)
    assert m["mae_mw"] == pytest.approx(500.0) and m["rmse_mw"] == pytest.approx(500.0)
    assert body["daily"][0]["selected_publications"] == ["2026-01-01T09:30:00Z"]
    assert body["insights"]


def test_epex_cutoff_excludes_0930_publication(api):
    m = api.get("/api/overview", params={"cutoff": "epex"}).json()["metrics"]
    assert m["bias_mw"] == pytest.approx(200.0)


def test_date_filter_and_series(api):
    body = api.get("/api/forecast-vs-actual", params={"start": "2026-01-10", "end": "2026-01-11"}).json()
    assert len(body["intervals"]) == 96
    assert body["coverage"]["delivery_days"] == 2
    first = body["intervals"][0]
    assert first["start_time"] == "2026-01-10T00:00:00Z"
    assert first["error_mw"] == 500.0 and first["cutoff_utc"] == "2026-01-09T09:50:00Z"
    assert body["intervals"][1]["status"] == "not_evaluated"


def test_accuracy_payload(api):
    body = api.get("/api/accuracy", params={"alignment": "interpolated"}).json()
    assert body["metrics"]["n"] == 1488
    assert len(body["by_hour"]) == 24
    assert sum(b["count"] for b in body["error_histogram"]) == 1488
    # Hindsight benchmark picks the post-cutoff +9000 MW publication for some intervals.
    assert body["benchmark"]["latest_before_delivery"]["mae_mw"] > body["benchmark"]["day_ahead"]["mae_mw"]


def test_publications_flags_eligible_and_selected(api):
    body = api.get("/api/forecast-publications", params={"date": "2026-01-15"}).json()
    assert body["cutoff_utc"] == "2026-01-14T09:50:00Z"
    selected = [r for r in body["rows"] if r["selected"]]
    assert len(selected) == 24
    assert {r["publish_time"] for r in selected} == {"2026-01-14T09:30:00Z"}
    assert all(r["eligible"] for r in selected)
    later = [r for r in body["rows"] if r["publish_time"] == "2026-01-14T10:30:00Z"]
    assert later and not any(r["eligible"] or r["selected"] for r in later)
    assert len(body["actuals"]) == 48


def test_source_data_cached_between_requests(api):
    api.get("/api/overview")
    api.get("/api/accuracy")
    api.get("/api/forecast-vs-actual", params={"cutoff": "epex"})
    assert [c[0] for c in api.fake.calls] == ["FUELHH", "WINDFOR"]


@pytest.mark.parametrize(
    "path,params",
    [
        ("/api/overview", {"start": "2025-12-15"}),
        ("/api/overview", {"end": "2026-03-01"}),
        ("/api/overview", {"start": "2026-01-20", "end": "2026-01-10"}),
        ("/api/overview", {"cutoff": "nope"}),
        ("/api/accuracy", {"alignment": "nope"}),
        ("/api/forecast-vs-actual", {"start": "not-a-date"}),
        ("/api/forecast-publications", {}),
        ("/api/forecast-publications", {"date": "2026-01-01"}),
    ],
)
def test_validation_errors_return_400(api, path, params):
    r = api.get(path, params=params)
    assert r.status_code == 400
    body = r.json()
    assert body["error"] == "invalid_request" and body["detail"]


def test_upstream_failure_returns_503_without_stack_trace(settings):
    fake = FakeClient([], [], fail=ElexonError("boom", status=500, retryable=True))
    app = create_app(settings, client_factory=lambda: fake, warm_cache=False)
    with TestClient(app) as client:
        r = client.get("/api/overview")
    assert r.status_code == 503
    assert r.json()["error"] == "upstream_unavailable"
    assert "Traceback" not in r.text and "boom" not in r.text


def test_stale_cache_served_when_refresh_fails(settings, period_fixture):
    ok = FakeClient(*period_fixture)
    app = create_app(settings, client_factory=lambda: ok, warm_cache=False)
    with TestClient(app) as client:
        assert client.get("/api/overview").status_code == 200

    # Expire the cache, then make Elexon fail: the stale copy should be served and flagged.
    for f in settings.cache_dir.glob("*.json"):
        payload = json.loads(f.read_text())
        payload["fetched_at"] = "2020-01-01T00:00:00+00:00"
        f.write_text(json.dumps(payload))
    failing = FakeClient([], [], fail=ElexonError("down", retryable=True))
    app = create_app(settings, client_factory=lambda: failing, warm_cache=False)
    with TestClient(app) as client:
        r = client.get("/api/overview")
    assert r.status_code == 200
    assert all(s["stale"] for s in r.json()["context"]["sources"])
    assert r.json()["metrics"]["n"] == 744


def test_unexpected_errors_are_hidden(settings, period_fixture):
    fake = FakeClient(*period_fixture)
    app = create_app(settings, client_factory=lambda: fake, warm_cache=False)
    app.state.service.intervals = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret internals"))
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.get("/api/overview")
    assert r.status_code == 500
    assert "secret" not in r.text


def test_cors_allows_configured_origins_only(settings, period_fixture):
    from dataclasses import replace

    s = replace(settings, cors_origins=["https://app.example.com"], cors_origin_regex=r"^https://.*\.vercel\.app$")
    app = create_app(s, client_factory=lambda: FakeClient(*period_fixture), warm_cache=False)
    with TestClient(app) as client:
        def allowed(origin):
            r = client.get("/api/health", headers={"Origin": origin})
            return r.headers.get("access-control-allow-origin") == origin

        assert allowed("https://app.example.com")
        assert allowed("https://my-preview-abc.vercel.app")
        assert not allowed("https://evil.example.org")
