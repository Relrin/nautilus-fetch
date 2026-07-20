"""The catalog written by the engine must load in polars, via catalog.query, and
run through a Nautilus BacktestEngine - proving training pipelines and backtests
can both consume the output.
"""

import asyncio
import time
from datetime import UTC, datetime
from types import SimpleNamespace

import polars as pl
import pytest

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.engine import JobSpec, JobEngine
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from tests.fake_ib import FakeConn, FakeIB, aapl_details

BAR_TYPE = "AAPL.NASDAQ-1-MINUTE-LAST-EXTERNAL"


@pytest.fixture
async def completed_job(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/rt.sqlite"
    await run_migrations(url)
    db = create_db_engine(url)
    fake = FakeIB()
    fake.add_details(aapl_details())
    settings = Settings(database_url=url, catalog_path=tmp_path / "catalog", _env_file=None)
    writer = CatalogWriter(settings.catalog_path)
    engine = JobEngine(
        db=db,
        conn=FakeConn(fake),
        pacing=PacingGate(max_requests=10_000, identical_cooldown_s=0.0),
        writer=writer,
        search=InstrumentSearchService(FakeConn(fake), db, search_min_interval_s=0.0),
        settings=settings,
    )
    job, _ = await engine.submit(
        JobSpec(
            con_ids=[265598],
            bar_size="M1",
            range_start=datetime(2026, 6, 1, tzinfo=UTC),
            range_end=datetime(2026, 6, 3, tzinfo=UTC),
        )
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        row = await jobs_repo.get(db, job["id"])
        if row["state"] in {"completed", "completed_with_failures", "failed"}:
            break
        await asyncio.sleep(0.02)
    assert row["state"] == "completed"
    yield SimpleNamespace(job=row, writer=writer, settings=settings)
    await engine.stop()
    await db.dispose()


def test_polars_reads_catalog_files(completed_job):
    files = sorted((completed_job.settings.catalog_path / "data").rglob("*.parquet"))
    bar_files = [f for f in files if BAR_TYPE in str(f)]
    assert bar_files
    df = pl.concat([pl.read_parquet(f) for f in bar_files]).sort("ts_event")
    assert {"open", "high", "low", "close", "volume", "ts_event", "ts_init"} <= set(df.columns)
    assert df.height == completed_job.job["rows_written"]
    assert df["ts_event"].is_sorted()
    assert df["ts_event"].n_unique() == df.height


def test_catalog_query_returns_all_bars(completed_job):
    from nautilus_trader.model.data import Bar

    bars = completed_job.writer.catalog.query(Bar, identifiers=[BAR_TYPE])
    assert len(bars) == completed_job.job["rows_written"]
    assert str(bars[0].bar_type) == BAR_TYPE
    # timestamps strictly increasing
    ts = [bar.ts_event for bar in bars]
    assert all(a < b for a, b in zip(ts, ts[1:]))


def test_backtest_engine_consumes_catalog(completed_job):
    from nautilus_trader.backtest.engine import BacktestEngine, BacktestEngineConfig
    from nautilus_trader.common.config import LoggingConfig
    from nautilus_trader.model.currencies import USD
    from nautilus_trader.model.data import Bar
    from nautilus_trader.model.enums import AccountType, OmsType
    from nautilus_trader.model.identifiers import Venue
    from nautilus_trader.model.objects import Money

    catalog = completed_job.writer.catalog
    instruments = catalog.instruments(instrument_ids=["AAPL.NASDAQ"])
    assert len(instruments) == 1
    bars = catalog.query(Bar, identifiers=[BAR_TYPE])

    engine = BacktestEngine(
        config=BacktestEngineConfig(logging=LoggingConfig(bypass_logging=True))
    )
    try:
        engine.add_venue(
            venue=Venue("NASDAQ"),
            oms_type=OmsType.NETTING,
            account_type=AccountType.CASH,
            base_currency=USD,
            starting_balances=[Money(1_000_000, USD)],
        )
        engine.add_instrument(instruments[0])
        engine.add_data(bars)
        engine.run()
    finally:
        engine.dispose()
