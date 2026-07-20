import asyncio
import time

from fastapi.testclient import TestClient

from nautilus_fetch.api.ws import WsHub
from nautilus_fetch.engine.engine import JobEngine
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from tests.fake_ib import FakeConn, FakeIB, aapl_details


def wire_fake_engine(app) -> FakeIB:
    """Swap the lifespan-built engine for one running against FakeIB."""
    fake = FakeIB()
    fake.add_details(aapl_details())
    conn = FakeConn(fake)
    app.state.search = InstrumentSearchService(conn, app.state.db, search_min_interval_s=0.0)
    app.state.engine = JobEngine(
        db=app.state.db,
        conn=conn,
        pacing=PacingGate(max_requests=10_000, identical_cooldown_s=0.0),
        writer=CatalogWriter(app.state.settings.catalog_path),
        search=app.state.search,
        settings=app.state.settings,
        hub=app.state.hub,
    )
    return fake


def poll_job(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] in {"completed", "completed_with_failures", "failed", "canceled"}:
            return body
        time.sleep(0.05)
    raise TimeoutError(body)


JOB_REQUEST = {
    "con_ids": [265598],
    "bar_size": "M1",
    "start": "2026-06-01T00:00:00Z",
    "end": "2026-06-03T00:00:00Z",
}


def test_job_lifecycle_via_api(tmp_settings):
    from nautilus_fetch.main import create_app

    app = create_app(tmp_settings)
    with TestClient(app) as client:
        wire_fake_engine(app)

        created = client.post("/api/jobs", json=JOB_REQUEST)
        assert created.status_code == 201, created.text
        job = created.json()
        assert job["state"] in {"queued", "running"}
        assert job["total_chunks"] == 2
        assert job["params"]["bar_size"] == "1 min"

        final = poll_job(client, job["id"])
        assert final["state"] == "completed"
        assert final["progress"] == 1.0
        assert final["rows_written"] == 2 * 1440

        listed = client.get("/api/jobs").json()
        assert [item["id"] for item in listed] == [job["id"]]

        chunks = client.get(f"/api/jobs/{job['id']}/chunks").json()
        assert chunks["total"] == 2
        done_code = chunks["state_codes"]["done"]
        assert chunks["cells"] == [[0, done_code], [1, done_code]]

        assert client.get(f"/api/jobs/{job['id']}/failures").json() == []


def test_job_api_validation_errors(tmp_settings):
    from nautilus_fetch.main import create_app

    app = create_app(tmp_settings)
    with TestClient(app) as client:
        wire_fake_engine(app)

        bad_bar_size = client.post("/api/jobs", json={**JOB_REQUEST, "bar_size": "7 mins"})
        assert bad_bar_size.status_code == 422

        unknown_conid = client.post("/api/jobs", json={**JOB_REQUEST, "con_ids": [424242]})
        assert unknown_conid.status_code == 404

        assert client.get("/api/jobs/01UNKNOWN").status_code == 404
        assert client.post("/api/jobs/01UNKNOWN/pause").status_code == 404


async def test_ws_hub_coalesces_frames():
    class StubWebSocket:
        def __init__(self) -> None:
            self.sent: list[dict] = []
            self._blocker: asyncio.Future = asyncio.get_event_loop().create_future()

        async def accept(self) -> None: ...

        async def receive_text(self) -> str:
            return await self._blocker

        async def send_json(self, data: dict) -> None:
            self.sent.append(data)

    hub = WsHub(batch_ms=20)
    await hub.start()
    stub = StubWebSocket()
    handler = asyncio.create_task(hub.handle(stub))
    await asyncio.sleep(0.01)

    hub.emit_job("j1", {"done_chunks": 1})
    hub.emit_job("j1", {"done_chunks": 2, "rows_written": 100})
    hub.emit_chunk("j1", 0, "active")
    hub.emit_chunk("j1", 0, "done")
    hub.emit_chunk("j1", 1, "active")
    await asyncio.sleep(0.1)

    job_frames = [f for f in stub.sent if f["t"] == "job"]
    chunk_frames = [f for f in stub.sent if f["t"] == "chunks"]
    # patches coalesced into one frame with the latest values
    assert len(job_frames) == 1
    assert job_frames[0]["patch"] == {"done_chunks": 2, "rows_written": 100}
    # per-seq latest state wins: seq 0 -> done(2), seq 1 -> active(1)
    assert chunk_frames[0]["cells"] == [(0, 2), (1, 1)] or chunk_frames[0]["cells"] == [[0, 2], [1, 1]]

    handler.cancel()
    try:
        await handler
    except asyncio.CancelledError:
        pass
    await hub.stop()
