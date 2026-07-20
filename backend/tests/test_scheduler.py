import asyncio
import json
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from ulid import ULID

from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.db.repos import schedules as schedules_repo
from nautilus_fetch.engine.engine import JobEngine
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate
from nautilus_fetch.scheduler import Scheduler, ScheduleError, validate_cron
from tests.fake_ib import FakeConn, FakeIB, aapl_details

TERMINAL = {"completed", "completed_with_failures", "failed", "canceled"}


def test_validate_cron():
    validate_cron("30 2 * * 1-5")
    with pytest.raises(ScheduleError):
        validate_cron("not a cron")


@pytest.fixture
async def env(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/sched.sqlite"
    await run_migrations(url)
    db = create_db_engine(url)
    fake = FakeIB()
    fake.add_details(aapl_details())
    conn = FakeConn(fake)
    settings = Settings(
        database_url=url,
        catalog_path=tmp_path / "catalog",
        retry_backoff_base_s=0.01,
        _env_file=None,
    )
    engine = JobEngine(
        db=db,
        conn=conn,
        pacing=PacingGate(max_requests=10_000, identical_cooldown_s=0.0),
        writer=CatalogWriter(settings.catalog_path),
        search=InstrumentSearchService(conn, db, search_min_interval_s=0.0),
        settings=settings,
    )
    # frozen "now" on a Thursday so weekday chunks exist
    clock = SimpleNamespace(now=datetime(2026, 6, 4, 12, 0, tzinfo=UTC))
    scheduler = Scheduler(db, engine, now=lambda: clock.now)
    yield SimpleNamespace(db=db, fake=fake, engine=engine, scheduler=scheduler, clock=clock)
    await scheduler.stop()
    await engine.stop()
    await db.dispose()


async def make_schedule(db, *, enabled=1, catchup=0, next_run_at=None, **template) -> dict:
    template.setdefault("con_ids", [265598])
    template.setdefault("data_type", "BARS")
    template.setdefault("bar_size", "1 min")
    template.setdefault("lag_minutes", 0)
    template.setdefault("lookback_days", 2)
    row = {
        "id": str(ULID()),
        "name": "nightly-test",
        "cron": "0 3 * * *",
        "enabled": enabled,
        "catchup": catchup,
        "job_template_json": json.dumps(template),
        "next_run_at": next_run_at,
    }
    await schedules_repo.insert(db, row)
    return row


async def wait_all_terminal(db, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        jobs = await jobs_repo.list_jobs(db)
        if jobs and all(job["state"] in TERMINAL for job in jobs):
            return jobs
        await asyncio.sleep(0.02)
    raise TimeoutError


async def test_trigger_creates_incremental_job_and_second_run_continues(env):
    schedule = await make_schedule(env.db)
    job = await env.scheduler.trigger(schedule)
    assert job is not None
    assert job["schedule_id"] == schedule["id"]
    # first run: lookback window (2 days: Tue+Wed, Thu partial)
    await wait_all_terminal(env.db)

    first = await jobs_repo.get(env.db, job["id"])
    assert first["state"] == "completed"
    first_end = first["range_end_ns"]

    # nothing new: immediately re-trigger -> up to date
    assert await env.scheduler.trigger(schedule) is None

    # advance the clock 6 hours: next run picks up exactly where the last ended
    env.clock.now = env.clock.now + timedelta(hours=6)
    second = await env.scheduler.trigger(schedule)
    assert second is not None
    assert second["range_start_ns"] == first_end
    await wait_all_terminal(env.db)


async def test_tick_fires_due_schedules_and_reschedules(env):
    past_ms = int((env.clock.now - timedelta(minutes=1)).timestamp() * 1000)
    schedule = await make_schedule(env.db, next_run_at=past_ms)
    await env.scheduler.tick()

    jobs = await jobs_repo.list_jobs(env.db)
    assert len(jobs) == 1
    updated = await schedules_repo.get(env.db, schedule["id"])
    assert updated["last_run_at"] is not None
    assert updated["next_run_at"] > int(env.clock.now.timestamp() * 1000)
    await wait_all_terminal(env.db)

    # not due anymore: nothing else fires
    await env.scheduler.tick()
    assert len(await jobs_repo.list_jobs(env.db)) == 1


async def test_disabled_schedules_do_not_fire(env):
    past_ms = int((env.clock.now - timedelta(minutes=1)).timestamp() * 1000)
    await make_schedule(env.db, enabled=0, next_run_at=past_ms)
    await env.scheduler.tick()
    assert await jobs_repo.list_jobs(env.db) == []


async def test_startup_catchup_policy(env):
    past_ms = int((env.clock.now - timedelta(hours=5)).timestamp() * 1000)
    with_catchup = await make_schedule(env.db, catchup=1, next_run_at=past_ms)
    without_catchup = await make_schedule(env.db, catchup=0, next_run_at=past_ms)

    await env.scheduler.start()
    try:
        jobs = await jobs_repo.list_jobs(env.db)
        assert len(jobs) == 1  # only the catchup schedule fired
        assert jobs[0]["schedule_id"] == with_catchup["id"]
        for schedule_id in (with_catchup["id"], without_catchup["id"]):
            row = await schedules_repo.get(env.db, schedule_id)
            assert row["next_run_at"] > int(env.clock.now.timestamp() * 1000)
        await wait_all_terminal(env.db)
    finally:
        await env.scheduler.stop()


async def test_run_now_unknown_schedule(env):
    with pytest.raises(ScheduleError, match="not found"):
        await env.scheduler.run_now("01NOPE")
