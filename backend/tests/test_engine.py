import asyncio
import time
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from ib_async import RequestError

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.engine import JobEngine, JobSpec, JobValidationError
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from tests.fake_ib import FakeConn, FakeIB, aapl_details, eurusd_details, msft_details

# Mon..Thu window in June 2026: three weekday chunks per symbol at 1-min bars
START = datetime(2026, 6, 1, tzinfo=UTC)
END = datetime(2026, 6, 4, tzinfo=UTC)

TERMINAL = {"completed", "completed_with_failures", "failed", "canceled"}


def make_spec(**kwargs) -> JobSpec:
    kwargs.setdefault("con_ids", [265598])
    kwargs.setdefault("bar_size", "M1")
    kwargs.setdefault("range_start", START)
    kwargs.setdefault("range_end", END)
    kwargs.setdefault("max_retries", 2)
    return JobSpec(**kwargs)


@pytest.fixture
async def env(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/engine.sqlite"
    await run_migrations(url)
    db = create_db_engine(url)
    fake = FakeIB()
    for details in (aapl_details(), msft_details(), eurusd_details()):
        fake.add_details(details)
    conn = FakeConn(fake)
    settings = Settings(
        database_url=url,
        catalog_path=tmp_path / "catalog",
        retry_backoff_base_s=0.01,
        retry_backoff_max_s=0.05,
        pacing_violation_cooldown_s=0.01,
        _env_file=None,
    )
    writer = CatalogWriter(settings.catalog_path)

    def build_engine() -> JobEngine:
        return JobEngine(
            db=db,
            conn=conn,
            pacing=PacingGate(
                max_requests=10_000,
                identical_cooldown_s=0.0,
                contract_burst=10_000,
                contract_burst_window_s=0.001,
            ),
            writer=writer,
            search=InstrumentSearchService(conn, db, search_min_interval_s=0.0),
            settings=settings,
        )

    engine = build_engine()
    yield SimpleNamespace(
        db=db, fake=fake, engine=engine, writer=writer, settings=settings, build_engine=build_engine
    )
    await engine.stop()
    await db.dispose()


async def wait_terminal(db, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = await jobs_repo.get(db, job_id)
        if job["state"] in TERMINAL:
            return job
        await asyncio.sleep(0.02)
    raise TimeoutError(f"job {job_id} still {job['state']}")


async def test_happy_path_two_symbols(env):
    job, warnings = await env.engine.submit(make_spec(con_ids=[265598, 272093]))
    assert job["total_chunks"] == 6  # 3 weekdays x 2 symbols
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["done_chunks"] == 6
    assert final["failed_chunks"] == 0
    assert final["rows_written"] == 6 * 1440
    assert final["bytes_written"] > 0
    assert env.fake.calls["reqHistoricalData"] == 6

    catalog_files = list((env.settings.catalog_path / "data").rglob("*.parquet"))
    assert catalog_files


async def test_empty_chunk_counts_as_success(env):
    env.fake.add_fault(
        265598,
        RequestError(1, 162, "Historical Market Data Service error message:HMDS query returned no data"),
    )
    job, _ = await env.engine.submit(make_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["empty_chunks"] == 1
    assert final["done_chunks"] == 2


async def test_transient_error_retries_until_success(env):
    env.fake.add_fault(265598, RequestError(1, 9999, "flaky farm"))
    env.fake.add_fault(265598, RequestError(1, 9999, "flaky farm again"))
    job, _ = await env.engine.submit(make_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["done_chunks"] == 3
    # 3 chunks + 2 retried attempts
    assert env.fake.calls["reqHistoricalData"] == 5


async def test_transient_exhaustion_fails_chunk(env):
    for _ in range(5):
        env.fake.add_fault(265598, RequestError(1, 9999, "always broken"))
    # single-day range -> exactly one chunk, which exhausts its retry budget
    job, _ = await env.engine.submit(
        make_spec(max_retries=1, range_end=datetime(2026, 6, 2, tzinfo=UTC))
    )
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed_with_failures"
    assert final["failed_chunks"] == 1
    failures = await chunks_repo.failures(env.db, job["id"])
    assert len(failures) == 1
    assert failures[0]["last_error_msg"] == "always broken"
    assert failures[0]["attempts"] == 2  # initial attempt + one retry


async def test_permanent_error_fails_immediately_with_hint(env):
    env.fake.add_fault(265598, RequestError(1, 354, "Requested market data is not subscribed"))
    job, _ = await env.engine.submit(make_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed_with_failures"
    failures = await chunks_repo.failures(env.db, job["id"])
    assert "subscription" in failures[0]["last_error_msg"]
    # permanent failures burn no retries
    assert env.fake.calls["reqHistoricalData"] == 3


async def test_pacing_violation_requeues_without_attempt(env):
    env.fake.add_fault(265598, RequestError(1, 162, "API historical data query cancelled: pacing violation"))
    job, _ = await env.engine.submit(make_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["done_chunks"] == 3
    cells = await chunks_repo.cells(env.db, job["id"])
    assert all(state == "done" for _, state in cells)


async def test_retry_failed_after_completion(env):
    env.fake.add_fault(265598, RequestError(1, 354, "Requested market data is not subscribed"))
    job, _ = await env.engine.submit(make_spec())
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed_with_failures"

    await env.engine.retry_failed(job["id"])
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["failed_chunks"] == 0
    assert final["done_chunks"] == 3


async def test_pause_and_resume(env):
    env.fake.latency_s = 0.05
    job, _ = await env.engine.submit(make_spec(con_ids=[265598, 272093], workers=1))
    await env.engine.pause(job["id"])
    await asyncio.sleep(0.15)
    calls_while_paused = env.fake.calls["reqHistoricalData"]
    await asyncio.sleep(0.2)
    # at most the in-flight request finished; nothing new started
    assert env.fake.calls["reqHistoricalData"] <= calls_while_paused + 1
    row = await jobs_repo.get(env.db, job["id"])
    assert row["state"] == "paused"

    await env.engine.resume(job["id"])
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"


async def test_cancel(env):
    env.fake.latency_s = 0.05
    job, _ = await env.engine.submit(make_spec(con_ids=[265598, 272093], workers=1))
    await asyncio.sleep(0.08)
    await env.engine.cancel(job["id"])
    row = await jobs_repo.get(env.db, job["id"])
    assert row["state"] == "canceled"
    assert not env.engine.runner_active(job["id"])


async def test_restart_resume_no_refetch_of_done_chunks(env):
    env.fake.latency_s = 0.03
    job, _ = await env.engine.submit(make_spec(con_ids=[265598, 272093], workers=1))
    # let some chunks finish, then simulate a crash
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        row = await jobs_repo.get(env.db, job["id"])
        if row["done_chunks"] >= 2:
            break
        await asyncio.sleep(0.01)
    await env.engine.stop()
    done_before = (await jobs_repo.get(env.db, job["id"]))["done_chunks"]
    calls_before = env.fake.calls["reqHistoricalData"]
    assert done_before >= 2

    env.fake.latency_s = 0.0
    engine2 = env.build_engine()
    await engine2.start()  # resumes the running job from DB
    final = await wait_terminal(env.db, job["id"])
    assert final["state"] == "completed"
    assert final["done_chunks"] == 6
    # only the not-yet-done chunks (plus at most one requeued in-flight) were fetched
    assert env.fake.calls["reqHistoricalData"] - calls_before <= 6 - done_before + 1
    await engine2.stop()


async def test_rerun_same_range_is_idempotent(env):
    from nautilus_trader.model.data import Bar

    job1, _ = await env.engine.submit(make_spec())
    await wait_terminal(env.db, job1["id"])
    rows_first = (await jobs_repo.get(env.db, job1["id"]))["rows_written"]

    # same instrument, same range: every chunk hits the overlap -> delete -> rewrite path
    job2, _ = await env.engine.submit(make_spec())
    final2 = await wait_terminal(env.db, job2["id"])
    assert final2["state"] == "completed"

    bars = env.writer.catalog.query(
        Bar, identifiers=["AAPL.NASDAQ-1-MINUTE-LAST-EXTERNAL"]
    )
    assert len(bars) == rows_first  # no duplicates in the catalog


async def test_submit_rejects_unknown_bar_size(env):
    with pytest.raises(JobValidationError):
        await env.engine.submit(make_spec(bar_size="7 mins"))
