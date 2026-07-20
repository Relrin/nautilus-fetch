import asyncio
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.engine import JobEngine, JobSpec
from nautilus_fetch.engine.planner import InstrumentPlanInput, plan_ticks
from nautilus_fetch.engine.throughput import ThroughputTracker
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from tests.fake_ib import FakeConn, FakeIB, aapl_details, eurusd_details

NOW = datetime(2026, 7, 20, tzinfo=UTC)
AAPL = InstrumentPlanInput(con_id=265598, instrument_id="AAPL.NASDAQ", sec_type="STK")
EURUSD = InstrumentPlanInput(con_id=12087792, instrument_id="EUR/USD.IDEALPRO", sec_type="CASH")

# recent range (ticks are only available ~6 months back): Mon 2026-06-01
T0 = datetime(2026, 6, 1, 10, 0, tzinfo=UTC)

TERMINAL = {"completed", "completed_with_failures", "failed", "canceled"}


# -- planner ------------------------------------------------------------------


def test_plan_ticks_hourly_for_stocks_daily_for_fx():
    chunks, _ = plan_ticks(
        [AAPL],
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 2, tzinfo=UTC),
        now=NOW,
        max_chunks=1000,
    )
    assert len(chunks) == 24  # hourly

    chunks, _ = plan_ticks(
        [EURUSD],
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 8, tzinfo=UTC),
        now=NOW,
        max_chunks=1000,
    )
    assert len(chunks) == 7  # daily, weekends kept


def test_plan_ticks_skips_stock_weekends():
    from nautilus_fetch.engine.planner import PlanningError

    # Sat..Mon for a stock: every hourly chunk is weekend -> nothing to plan
    with pytest.raises(PlanningError, match="no chunks"):
        plan_ticks(
            [AAPL],
            datetime(2026, 6, 6, tzinfo=UTC),  # Sat
            datetime(2026, 6, 8, tzinfo=UTC),  # Mon
            now=NOW,
            max_chunks=1000,
        )


def test_plan_ticks_clamps_to_availability():
    chunks, warnings = plan_ticks(
        [EURUSD],
        NOW - timedelta(days=400),
        NOW - timedelta(days=170),
        now=NOW,
        max_chunks=10_000,
    )
    assert chunks
    assert any("clamped" in w for w in warnings)


# -- engine -------------------------------------------------------------------


@pytest.fixture
async def env(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/ticks.sqlite"
    await run_migrations(url)
    db = create_db_engine(url)
    fake = FakeIB()
    fake.add_details(aapl_details())
    fake.add_details(eurusd_details())
    conn = FakeConn(fake)
    settings = Settings(
        database_url=url,
        catalog_path=tmp_path / "catalog",
        retry_backoff_base_s=0.01,
        retry_backoff_max_s=0.05,
        pacing_violation_cooldown_s=0.01,
        throughput_sample_interval_s=0.02,
        throughput_persist_every=1,
        _env_file=None,
    )
    writer = CatalogWriter(settings.catalog_path)
    pacing = PacingGate(
        max_requests=100_000, identical_cooldown_s=0.0, contract_burst=100_000
    )
    tracker = ThroughputTracker(
        db,
        interval_s=settings.throughput_sample_interval_s,
        persist_every=settings.throughput_persist_every,
    )
    await tracker.start()
    engine = JobEngine(
        db=db,
        conn=conn,
        pacing=pacing,
        writer=writer,
        search=InstrumentSearchService(conn, db, search_min_interval_s=0.0),
        settings=settings,
        throughput=tracker,
    )
    yield SimpleNamespace(
        db=db, fake=fake, engine=engine, writer=writer, settings=settings,
        pacing=pacing, tracker=tracker,
    )
    await engine.stop()
    await tracker.stop()
    await db.dispose()


async def wait_terminal(db, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = await jobs_repo.get(db, job_id)
        if job["state"] in TERMINAL:
            return job
        await asyncio.sleep(0.02)
    raise TimeoutError(f"job {job_id} still {job['state']}")


def tick_spec(**kwargs) -> JobSpec:
    kwargs.setdefault("con_ids", [265598])
    kwargs.setdefault("data_type", "TRADE_TICKS")
    kwargs.setdefault("range_start", T0)
    kwargs.setdefault("range_end", T0 + timedelta(hours=2))
    kwargs.setdefault("max_retries", 2)
    return JobSpec(**kwargs)


async def test_trade_ticks_paged_without_dupes_or_gaps(env):
    # 1 tick every 2s -> 1800/hour -> two 1000-tick pages per hourly chunk
    job, _ = await env.engine.submit(tick_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["total_chunks"] == 2
    assert final["rows_written"] == 2 * 1800
    # 2 pages per chunk: page boundaries overlap by one second, deduped
    assert env.fake.calls["reqHistoricalTicks"] == 4

    from nautilus_trader.model.data import TradeTick

    ticks = env.writer.catalog.query(TradeTick, identifiers=["AAPL.NASDAQ"])
    assert len(ticks) == 3600
    ts = [t.ts_event for t in ticks]
    assert ts == sorted(ts)
    assert len(set((t.ts_event, t.trade_id.value) for t in ticks)) == 3600


async def test_dense_second_sets_gap_warning(env):
    # 1500 ticks inside one second: only the first 1000 are reachable via the API
    dense_at = int(T0.timestamp())
    env.fake.dense_seconds[(265598, dense_at)] = 1500
    job, _ = await env.engine.submit(tick_spec(range_end=T0 + timedelta(hours=1)))
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"

    cells = await chunks_repo.cells(env.db, job["id"])
    assert all(state == "done" for _, state in cells)
    async with env.db.connect() as dbconn:
        import sqlalchemy as sa

        from nautilus_fetch.db.schema import chunks as chunks_table

        result = await dbconn.execute(
            sa.select(chunks_table.c.gap_warning).where(chunks_table.c.job_id == job["id"])
        )
        assert [row.gap_warning for row in result] == [1]

    # 1000 reachable dense ticks + regular grid ticks for the rest of the hour
    assert final["rows_written"] == 1000 + 1799


async def test_quote_ticks_cost_double_in_pacing(env):
    job, _ = await env.engine.submit(
        tick_spec(
            con_ids=[12087792],
            data_type="QUOTE_TICKS",
            range_start=datetime(2026, 6, 1, tzinfo=UTC),
            range_end=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        )
    )
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["total_chunks"] == 1  # FX -> daily window covers the half day

    assert all(call["what"] == "BID_ASK" for call in env.fake.tick_calls)
    # 12h at 1 tick/2s = 21600 ticks -> 22 pages; head-timestamp preflight cost 1
    pages = env.fake.calls["reqHistoricalTicks"]
    assert env.pacing.snapshot()["window_cost"] == pages * 2 + 1

    from nautilus_trader.model.data import QuoteTick

    ticks = env.writer.catalog.query(QuoteTick, identifiers=["EUR/USD.IDEALPRO"])
    assert len(ticks) == final["rows_written"] > 0
    assert ticks[0].bid_price < ticks[0].ask_price


async def test_tick_job_resume_after_restart(env):
    env.fake.latency_s = 0.05
    job, _ = await env.engine.submit(tick_spec(workers=1))
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        row = await jobs_repo.get(env.db, job["id"])
        if row["done_chunks"] >= 1:
            break
        await asyncio.sleep(0.01)
    await env.engine.stop()
    assert (await jobs_repo.get(env.db, job["id"]))["done_chunks"] >= 1

    env.fake.latency_s = 0.0
    engine2 = JobEngine(
        db=env.db,
        conn=FakeConn(env.fake),
        pacing=env.pacing,
        writer=env.writer,
        search=InstrumentSearchService(FakeConn(env.fake), env.db, search_min_interval_s=0.0),
        settings=env.settings,
    )
    await engine2.start()
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["rows_written"] == 2 * 1800  # no duplicates after resume

    from nautilus_trader.model.data import TradeTick

    ticks = env.writer.catalog.query(TradeTick, identifiers=["AAPL.NASDAQ"])
    assert len(ticks) == 3600
    await engine2.stop()


async def test_throughput_sampler_records_samples(env):
    env.fake.latency_s = 0.03
    job, _ = await env.engine.submit(tick_spec())
    await asyncio.sleep(0.1)
    live = env.tracker.recent(job["id"], window_s=60)
    assert live is not None  # job registered while running
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"

    from nautilus_fetch.db.repos import samples as samples_repo

    persisted = await samples_repo.recent(env.db, job["id"], 0)
    assert persisted
    assert any(sample["rows_per_s"] > 0 for sample in persisted)
