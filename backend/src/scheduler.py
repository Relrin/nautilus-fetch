"""Recurring download schedules: a small croniter-driven asyncio loop.

Each enabled schedule holds a cron expression and a job template. On trigger it
plans an INCREMENTAL job: range start = the latest successfully fetched chunk
end across the schedule's previous jobs (per instrument, min over instruments;
instruments without history fall back to `lookback_days`), range end =
now - `lag_minutes`. Nothing new to fetch -> the run is skipped.

Misfires (next_run_at in the past after downtime): triggered once at startup
when the schedule has catchup=1, otherwise silently rescheduled from now.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from croniter import croniter
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import schedules as schedules_repo
from nautilus_fetch.engine.engine import JobEngine, JobSpec, JobValidationError

logger = logging.getLogger(__name__)

_NS = 1_000_000_000

DEFAULT_LAG_MINUTES = 15
DEFAULT_LOOKBACK_DAYS = 7


class ScheduleError(ValueError):
    pass


def validate_cron(expression: str) -> None:
    if not croniter.is_valid(expression):
        raise ScheduleError(f"Invalid cron expression: {expression!r}")


def next_run_ms(expression: str, base: datetime) -> int:
    nxt: datetime = croniter(expression, base).get_next(datetime)
    return int(nxt.timestamp() * 1000)


class Scheduler:
    def __init__(
        self,
        db: AsyncEngine,
        engine: JobEngine,
        *,
        poll_interval_s: float = 5.0,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._db = db
        self._engine = engine
        self._poll_interval_s = poll_interval_s
        self._now = now or (lambda: datetime.now(UTC))
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        await self._startup_pass()
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _startup_pass(self) -> None:
        """Initialize next_run_at; apply the catchup-once misfire policy."""
        now = self._now()
        now_ms = int(now.timestamp() * 1000)
        for schedule in await schedules_repo.list_enabled(self._db):
            next_at = schedule["next_run_at"]
            if next_at is None:
                await schedules_repo.update(
                    self._db, schedule["id"], next_run_at=next_run_ms(schedule["cron"], now)
                )
            elif next_at <= now_ms:
                if schedule["catchup"]:
                    logger.info("Schedule %s missed while down; catching up once", schedule["name"])
                    await self.trigger(schedule)
                await schedules_repo.stamp_run(
                    self._db, schedule["id"], next_run_ms(schedule["cron"], now)
                )

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Scheduler tick failed")
            await asyncio.sleep(self._poll_interval_s)

    async def tick(self) -> None:
        """Trigger every enabled schedule whose next_run_at has passed."""
        now = self._now()
        now_ms = int(now.timestamp() * 1000)
        for schedule in await schedules_repo.list_enabled(self._db):
            next_at = schedule["next_run_at"]
            if next_at is None:
                await schedules_repo.update(
                    self._db, schedule["id"], next_run_at=next_run_ms(schedule["cron"], now)
                )
                continue
            if next_at > now_ms:
                continue
            try:
                await self.trigger(schedule)
            except (JobValidationError, ScheduleError) as exc:
                logger.warning("Schedule %s trigger failed: %s", schedule["name"], exc)
            except Exception:
                logger.exception("Schedule %s trigger crashed", schedule["name"])
            await schedules_repo.stamp_run(
                self._db, schedule["id"], next_run_ms(schedule["cron"], now)
            )

    async def trigger(self, schedule: dict[str, Any]) -> dict[str, Any] | None:
        """Instantiate one incremental job from the template. None = nothing to fetch."""
        template = json.loads(schedule["job_template_json"])
        con_ids: list[int] = template["con_ids"]
        now = self._now()
        lag = timedelta(minutes=template.get("lag_minutes", DEFAULT_LAG_MINUTES))
        lookback = timedelta(days=template.get("lookback_days", DEFAULT_LOOKBACK_DAYS))
        range_end = now - lag

        last_ends = await chunks_repo.last_range_end_by_con(self._db, schedule["id"], con_ids)
        fallback_ns = int((range_end - lookback).timestamp() * _NS)
        start_ns = min(last_ends.get(con_id) or fallback_ns for con_id in con_ids)
        range_start = datetime.fromtimestamp(start_ns / _NS, tz=UTC)
        if range_start >= range_end:
            logger.info("Schedule %s: already up to date", schedule["name"])
            return None

        spec = JobSpec(
            con_ids=con_ids,
            data_type=template.get("data_type", "BARS"),
            bar_size=template.get("bar_size"),
            range_start=range_start,
            range_end=range_end,
            name=f"{schedule['name']} @ {range_end.strftime('%Y-%m-%d %H:%M')}",
            what_to_show=template.get("what_to_show"),
            use_rth=template.get("use_rth", True),
            workers=template.get("workers"),
            max_retries=template.get("max_retries", 3),
            schedule_id=schedule["id"],
        )
        job, warnings = await self._engine.submit(spec)
        for warning in warnings:
            logger.info("Schedule %s: %s", schedule["name"], warning)
        logger.info(
            "Schedule %s created job %s [%s .. %s]",
            schedule["name"],
            job["id"],
            range_start.isoformat(),
            range_end.isoformat(),
        )
        return job

    async def run_now(self, schedule_id: str) -> dict[str, Any] | None:
        schedule = await schedules_repo.get(self._db, schedule_id)
        if schedule is None:
            raise ScheduleError(f"Schedule {schedule_id} not found")
        job = await self.trigger(schedule)
        await schedules_repo.stamp_run(
            self._db, schedule_id, next_run_ms(schedule["cron"], self._now())
        )
        return job
