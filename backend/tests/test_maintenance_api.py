import time

from fastapi.testclient import TestClient

from nautilus_fetch.main import create_app
from tests.test_jobs_api import JOB_REQUEST, poll_job, wire_fake_engine

SCHEDULE_REQUEST = {
    "name": "nightly aapl",
    "cron": "30 2 * * 2-6",
    "template": {"con_ids": [265598], "data_type": "BARS", "bar_size": "M1"},
    "enabled": True,
}


def test_schedule_crud_and_run_now(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        wire_fake_engine(app)
        # scheduler needs the fake-backed engine too
        app.state.scheduler._engine = app.state.engine

        created = client.post("/api/schedules", json=SCHEDULE_REQUEST)
        assert created.status_code == 201, created.text
        schedule = created.json()
        assert schedule["cron"] == "30 2 * * 2-6"
        assert schedule["next_run_at"] is not None
        assert schedule["template"]["bar_size"] == "M1"

        assert client.post(
            "/api/schedules", json={**SCHEDULE_REQUEST, "cron": "bogus"}
        ).status_code == 422

        listed = client.get("/api/schedules").json()
        assert [s["id"] for s in listed] == [schedule["id"]]

        updated = client.put(
            f"/api/schedules/{schedule['id']}", json={"enabled": False}
        ).json()
        assert updated["enabled"] is False
        assert updated["next_run_at"] is None

        ran = client.post(f"/api/schedules/{schedule['id']}/run-now")
        assert ran.status_code == 200, ran.text
        job = ran.json()["job"]
        assert job is not None
        final = poll_job(client, job["id"])
        assert final["state"] == "completed"

        # immediately after: either up to date, or a sliver job continuing from
        # the incremental watermark (trailing weekend chunks may keep the
        # watermark slightly behind the previous range end)
        again = client.post(f"/api/schedules/{schedule['id']}/run-now").json()
        if again["job"] is not None:
            assert final["range_start"] <= again["job"]["range_start"] <= final["range_end"]
            poll_job(client, again["job"]["id"])

        assert client.delete(f"/api/schedules/{schedule['id']}").status_code == 204
        assert client.get(f"/api/schedules/{schedule['id']}").status_code == 404


def test_catalog_summary_and_consolidate(tmp_settings):
    app = create_app(tmp_settings)
    with TestClient(app) as client:
        wire_fake_engine(app)
        # writer used by routes must be the same one the fake engine writes to
        from nautilus_fetch.engine.writer import CatalogWriter

        app.state.writer = app.state.engine._writer

        created = client.post("/api/jobs", json=JOB_REQUEST)
        assert created.status_code == 201
        poll_job(client, created.json()["id"])

        summary = client.get("/api/catalog/summary").json()
        assert summary["total_bytes"] > 0
        data_types = {entry["data_type"] for entry in summary["classes"]}
        assert "bar" in data_types
        bar_entry = next(e for e in summary["classes"] if e["data_type"] == "bar")
        ident = bar_entry["identifiers"][0]
        assert ident["identifier"] == "AAPL.NASDAQ-1-MINUTE-LAST-EXTERNAL"
        files_before = ident["files"]
        assert files_before == 2  # one file per chunk

        result = client.post("/api/catalog/consolidate", json={"data_type": "bar"})
        assert result.status_code == 200, result.text

        summary = client.get("/api/catalog/summary").json()
        bar_entry = next(e for e in summary["classes"] if e["data_type"] == "bar")
        assert bar_entry["identifiers"][0]["files"] < files_before

        assert client.post(
            "/api/catalog/consolidate", json={"data_type": "nonsense"}
        ).status_code == 422
