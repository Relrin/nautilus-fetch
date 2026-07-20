from fastapi.testclient import TestClient

from nautilus_fetch.main import create_app


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
