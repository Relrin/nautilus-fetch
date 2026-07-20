from fastapi.testclient import TestClient

from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.main import create_app
from tests.fake_ib import FakeConn, FakeIB, aapl_details


def test_health_and_ib_status(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["db"] == "ok"

        response = client.get("/api/ib/status")
        assert response.status_code == 200
        status = response.json()
        assert status["state"] in {"disconnected", "connecting"}
        assert status["port"] == 1
        assert status["client_id"] == tmp_settings.ib_client_id


def test_instruments_api_returns_503_when_ib_down(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        response = client.get("/api/instruments/search", params={"q": "AAPL"})
        assert response.status_code == 503


def test_instruments_api_happy_path(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        fake_ib = FakeIB()
        fake_ib.add_details(aapl_details())
        app.state.search = InstrumentSearchService(
            FakeConn(fake_ib),
            app.state.db,
            search_min_interval_s=0.0,
        )

        response = client.get("/api/instruments/search", params={"q": "AAPL"})
        assert response.status_code == 200
        assert response.json()[0]["con_id"] == 265598

        response = client.get("/api/instruments/265598")
        assert response.status_code == 200
        body = response.json()
        assert body["instrument_id"] == "AAPL.NASDAQ"
        assert body["details"]["contract"]["symbol"] == "AAPL"
        assert "details_json" not in body

        response = client.get("/api/instruments/424242")
        assert response.status_code == 404


def test_instruments_cached_list(tmp_settings):
    """The sidebar reads this on load; it must work without touching IB."""
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        fake_ib = FakeIB()
        fake_ib.add_details(aapl_details())
        app.state.search = InstrumentSearchService(
            FakeConn(fake_ib),
            app.state.db,
            search_min_interval_s=0.0,
        )

        assert client.get("/api/instruments").json() == []

        # a details lookup populates the cache
        assert client.get("/api/instruments/265598").status_code == 200

        listed = client.get("/api/instruments").json()
        assert [row["con_id"] for row in listed] == [265598]
        assert listed[0]["symbol"] == "AAPL"
        assert "head_timestamp_ns" in listed[0]

        assert len(client.get("/api/instruments", params={"q": "aap"}).json()) == 1
        assert client.get("/api/instruments", params={"q": "ZZZZ"}).json() == []
        assert len(client.get("/api/instruments", params={"sec_type": "STK"}).json()) == 1
        assert client.get("/api/instruments", params={"sec_type": "CASH"}).json() == []


def test_instruments_cached_list_survives_ib_outage(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        # IB is down: search 503s, but the cached list still answers
        assert client.get("/api/instruments/search", params={"q": "AAPL"}).status_code == 503
        assert client.get("/api/instruments").status_code == 200
