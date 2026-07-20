"""Live smoke tests against a real IB paper gateway.

Excluded by default; run explicitly with:

    uv run pytest -m ib_live --no-header -rA

Requires IB_HOST/IB_PORT/IB_CLIENT_ID pointing at a paper gateway (port 4002)
with market data permissions for US stocks. Besides smoke-testing the full
pipeline, the captured error strings calibrate the classifier in ib/errors.py.
"""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import pytest

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.engine import JobEngine, JobSpec
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.connection import ConnState, IBConnectionManager
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate

pytestmark = pytest.mark.ib_live

TERMINAL = {"completed", "completed_with_failures", "failed", "canceled"}


@pytest.fixture
async def live(tmp_path):
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path.as_posix()}/live.sqlite",
        catalog_path=tmp_path / "catalog",
    )
    await run_migrations(settings.database_url)
    db = create_db_engine(settings.database_url)
    conn = IBConnectionManager(settings.ib_host, settings.ib_port, settings.ib_client_id)
    await conn.start()
    deadline = time.monotonic() + 30
    while conn.state is not ConnState.CONNECTED and time.monotonic() < deadline:
        await asyncio.sleep(0.5)
    if conn.state is not ConnState.CONNECTED:
        pytest.skip(f"No IB gateway reachable at {settings.ib_host}:{settings.ib_port}")

    search = InstrumentSearchService(conn, db)
    writer = CatalogWriter(settings.catalog_path)
    engine = JobEngine(
        db=db,
        conn=conn,
        pacing=PacingGate(),  # real pacing limits against the real gateway
        writer=writer,
        search=search,
        settings=settings,
    )
    yield type("Live", (), {
        "db": db, "conn": conn, "search": search, "engine": engine, "writer": writer,
    })
    await engine.stop()
    await conn.stop()
    await db.dispose()


async def _wait(db, job_id, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = await jobs_repo.get(db, job_id)
        if job["state"] in TERMINAL:
            return job
        await asyncio.sleep(1)
    raise TimeoutError(job)


async def test_live_search_and_daily_bars(live):
    results = await live.search.search("AAPL", sec_type="STK")
    assert results
    con_id = results[0]["con_id"]

    details = await live.search.details(con_id)
    assert details["instrument_id"].startswith("AAPL.")

    end = datetime.now(UTC) - timedelta(days=1)
    job, warnings = await live.engine.submit(
        JobSpec(con_ids=[con_id], bar_size="M1", range_start=end - timedelta(days=2), range_end=end)
    )
    final = await _wait(live.db, job["id"])
    assert final["state"] in ("completed", "completed_with_failures"), final
    assert final["rows_written"] > 0

    from nautilus_trader.model.data import Bar

    bars = live.writer.catalog.query(Bar)
    assert len(bars) == final["rows_written"]


async def test_live_trade_ticks_one_hour(live):
    results = await live.search.search("AAPL", sec_type="STK")
    con_id = results[0]["con_id"]
    # last full RTH hour of the most recent weekday
    end = datetime.now(UTC) - timedelta(days=1)
    while end.weekday() >= 5:
        end -= timedelta(days=1)
    end = end.replace(hour=18, minute=0, second=0, microsecond=0)

    job, _ = await live.engine.submit(
        JobSpec(
            con_ids=[con_id],
            data_type="TRADE_TICKS",
            range_start=end - timedelta(hours=1),
            range_end=end,
        )
    )
    final = await _wait(live.db, job["id"])
    assert final["state"] in ("completed", "completed_with_failures"), final
