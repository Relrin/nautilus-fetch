import asyncio
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.engine import JobEngine, JobSpec, JobValidationError
from nautilus_fetch.engine.recorder import CaptureWindow, book_to_depth10
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from tests.fake_ib import FakeConn, FakeIB, aapl_details, eurusd_details

# -- capture window ------------------------------------------------------------

NY = ZoneInfo("America/New_York")
RTH = CaptureWindow.from_params(
    {"start": "09:30", "end": "16:00", "tz": "America/New_York", "days": [0, 1, 2, 3, 4]}
)


def test_capture_window_contains():
    # Mon 2026-06-01 14:00 UTC == 10:00 New York -> inside
    assert RTH.contains(datetime(2026, 6, 1, 14, 0, tzinfo=UTC))
    # Mon 2026-06-01 12:00 UTC == 08:00 New York -> before open
    assert not RTH.contains(datetime(2026, 6, 1, 12, 0, tzinfo=UTC))
    # Sat 2026-06-06 14:00 UTC -> weekend
    assert not RTH.contains(datetime(2026, 6, 6, 14, 0, tzinfo=UTC))


def test_capture_window_next_open():
    # Fri 2026-06-05 21:00 UTC (17:00 NY, after close) -> opens Mon 09:30 NY
    seconds = RTH.seconds_until_open(datetime(2026, 6, 5, 21, 0, tzinfo=UTC))
    opens_at = datetime(2026, 6, 5, 17, 0, tzinfo=NY) + timedelta(seconds=seconds)
    assert opens_at == datetime(2026, 6, 8, 9, 30, tzinfo=NY)


def test_capture_window_rejects_overnight():
    from nautilus_fetch.engine.recorder import CaptureWindowError

    with pytest.raises(CaptureWindowError, match="overnight"):
        CaptureWindow.from_params({"start": "22:00", "end": "02:00"})


def test_book_to_depth10_pads_levels():
    from nautilus_fetch.ib.shim import details_to_instrument
    from tests.fake_ib import aapl_details as details

    instrument = details_to_instrument(details())
    levels = SimpleNamespace
    bids = [levels(price=100.0 - i * 0.01, size=100.0) for i in range(3)]
    asks = [levels(price=100.01 + i * 0.01, size=90.0) for i in range(3)]
    snapshot = book_to_depth10(instrument, bids, asks, sequence=7, ts_ns=1_000_000)
    assert len(snapshot.bids) == 10
    assert len(snapshot.asks) == 10
    assert snapshot.bid_counts == [1, 1, 1] + [0] * 7
    assert float(snapshot.bids[0].price) == 100.0
    assert float(snapshot.bids[3].size) == 0.0
    assert snapshot.sequence == 7


# -- recorder end-to-end ---------------------------------------------------------

TERMINAL = {"completed", "completed_with_failures", "failed", "canceled"}


@pytest.fixture
async def env(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/depth.sqlite"
    await run_migrations(url)
    db = create_db_engine(url)
    fake = FakeIB()
    fake.add_details(aapl_details())
    fake.add_details(eurusd_details())
    conn = FakeConn(fake)
    settings = Settings(
        database_url=url,
        catalog_path=tmp_path / "catalog",
        depth_snapshot_interval_ms=10,
        depth_flush_interval_s=0.06,
        max_depth_subscriptions=3,
        _env_file=None,
    )
    writer = CatalogWriter(settings.catalog_path)
    engine = JobEngine(
        db=db,
        conn=conn,
        pacing=PacingGate(max_requests=10_000, identical_cooldown_s=0.0),
        writer=writer,
        search=InstrumentSearchService(conn, db, search_min_interval_s=0.0),
        settings=settings,
    )
    yield SimpleNamespace(db=db, fake=fake, engine=engine, writer=writer, settings=settings)
    await engine.stop()
    await db.dispose()


def depth_spec(**kwargs) -> JobSpec:
    kwargs.setdefault("con_ids", [265598])
    kwargs.setdefault("data_type", "DEPTH")
    kwargs.setdefault("range_start", datetime.now(UTC))
    return JobSpec(**kwargs)


async def wait_for(predicate, timeout: float = 10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = await predicate()
        if result:
            return result
        await asyncio.sleep(0.02)
    raise TimeoutError


async def test_recorder_snapshots_flushes_and_stops(env):
    job, warnings = await env.engine.submit(depth_spec())
    assert warnings == []
    assert job["state"] in {"queued", "running"}
    assert env.fake.calls["reqMktDepth"] == 1

    # wait until at least two segments have been flushed
    async def two_chunks():
        row = await jobs_repo.get(env.db, job["id"])
        return row if row["done_chunks"] >= 2 else None

    await wait_for(two_chunks)

    stopped = await env.engine.stop_recorder(job["id"])
    assert stopped["state"] == "completed"
    assert env.fake.active_depth == set()  # unsubscribed

    final = await jobs_repo.get(env.db, job["id"])
    assert final["rows_written"] > 0
    assert final["total_chunks"] == final["done_chunks"] >= 2

    from nautilus_trader.model.data import OrderBookDepth10

    snapshots = env.writer.catalog.query(OrderBookDepth10, identifiers=["AAPL.NASDAQ"])
    assert len(snapshots) == final["rows_written"]
    first = snapshots[0]
    assert len(first.bids) == 10
    assert float(first.bids[0].price) > 0
    ts = [snapshot.ts_event for snapshot in snapshots]
    assert ts == sorted(ts)


async def test_recorder_capture_until_autocompletes(env):
    job, _ = await env.engine.submit(
        depth_spec(capture_until=datetime.now(UTC) - timedelta(seconds=1))
    )

    async def terminal():
        row = await jobs_repo.get(env.db, job["id"])
        return row if row["state"] in TERMINAL else None

    final = await wait_for(terminal)
    assert final["state"] == "completed"
    assert final["done_chunks"] == 0  # never captured


async def test_recorder_closed_window_idles(env):
    # a window on weekdays 00:00-00:01 UTC is (almost) always closed
    job, _ = await env.engine.submit(
        depth_spec(
            capture_window={"start": "00:00", "end": "00:01", "tz": "UTC", "days": [0, 1, 2, 3, 4]}
        )
    )
    await asyncio.sleep(0.15)
    row = await jobs_repo.get(env.db, job["id"])
    assert row["state"] == "running"
    assert env.fake.calls["reqMktDepth"] == 0  # idle outside the window
    canceled = await env.engine.cancel(job["id"])
    assert canceled["state"] == "canceled"


async def test_depth_subscription_budget(env):
    await env.engine.submit(depth_spec(con_ids=[265598, 12087792]))  # uses 2 of 3
    with pytest.raises(JobValidationError, match="budget"):
        await env.engine.submit(depth_spec(con_ids=[265598, 12087792]))  # +2 > 3


async def test_recorder_resume_after_restart_flags_gap(env):
    job, _ = await env.engine.submit(depth_spec())

    async def one_chunk():
        row = await jobs_repo.get(env.db, job["id"])
        return row if row["done_chunks"] >= 1 else None

    await wait_for(one_chunk)
    await env.engine.stop()  # graceful shutdown: flush, keep state=running
    row = await jobs_repo.get(env.db, job["id"])
    assert row["state"] == "running"
    chunks_before = row["done_chunks"]

    engine2 = JobEngine(
        db=env.db,
        conn=FakeConn(env.fake),
        pacing=PacingGate(max_requests=10_000, identical_cooldown_s=0.0),
        writer=env.writer,
        search=InstrumentSearchService(FakeConn(env.fake), env.db, search_min_interval_s=0.0),
        settings=env.settings,
    )
    await engine2.start()  # respawns the running recorder

    async def more_chunks():
        row = await jobs_repo.get(env.db, job["id"])
        return row if row["done_chunks"] > chunks_before else None

    await wait_for(more_chunks)
    await engine2.stop_recorder(job["id"])

    cells = await chunks_repo.cells(env.db, job["id"])
    assert all(state == "done" for _, state in cells)
    # the first post-restart segment is flagged: the stream has a hole
    import sqlalchemy as sa

    from nautilus_fetch.db.schema import chunks as chunks_table

    async with env.db.connect() as dbconn:
        result = await dbconn.execute(
            sa.select(chunks_table.c.seq, chunks_table.c.gap_warning)
            .where(chunks_table.c.job_id == job["id"])
            .order_by(chunks_table.c.seq)
        )
        rows = list(result)
    post_restart = [r.gap_warning for r in rows[chunks_before:]]
    assert post_restart and post_restart[0] == 1


async def test_retry_failed_rejected_for_depth(env):
    job, _ = await env.engine.submit(depth_spec())
    with pytest.raises(JobValidationError, match="retry-failed"):
        await env.engine.retry_failed(job["id"])
    await env.engine.stop_recorder(job["id"])
