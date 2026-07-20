"""Job engine: chunk queue + worker pool per running job, retry, resume.

Concurrency model: one IB socket, N in-flight chunk pipelines per job (workers).
Every wire request passes the shared PacingGate. The database is the source of
truth — the engine can be killed at any moment and resumed from it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ib_async import RequestError
from sqlalchemy.ext.asyncio import AsyncEngine
from ulid import ULID

from nautilus_trader.model.data import BarType
from nautilus_trader.model.instruments import Instrument

from nautilus_fetch.api.ws import NullHub
from nautilus_fetch.config import Settings
from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import instruments as instruments_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.barsize import BarSpec, bar_type_name, normalize_bar_size
from nautilus_fetch.engine.convert import (
    InstrumentConversionError,
    bars_to_nautilus,
    chunk_end_datetime,
    chunk_start_datetime,
    contract_from_row,
    instrument_from_row,
    quote_ticks_to_nautilus,
    trade_ticks_to_nautilus,
)
from nautilus_fetch.engine.planner import (
    InstrumentPlanInput,
    PlanningError,
    plan_bars,
    plan_ticks,
)
from nautilus_fetch.engine.recorder import (
    CaptureWindow,
    CaptureWindowError,
    DepthRecorderRunner,
)
from nautilus_fetch.engine.throughput import NullThroughput, ThroughputTracker
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.connection import IBConnectionManager
from nautilus_fetch.ib.errors import HINTS, ErrorClass, classify
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate

logger = logging.getLogger(__name__)

_NS = 1_000_000_000

DATA_TYPES = ("BARS", "TRADE_TICKS", "QUOTE_TICKS", "DEPTH")


class JobValidationError(ValueError):
    pass


class JobNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class JobSpec:
    con_ids: list[int]
    range_start: datetime
    range_end: datetime | None = None  # None only for DEPTH recorders
    data_type: str = "BARS"
    bar_size: str | None = None  # required for BARS
    name: str | None = None
    what_to_show: str | None = None  # BARS only; None -> per-instrument default
    use_rth: bool = True
    workers: int | None = None
    max_retries: int = 3
    # DEPTH recorder options
    depth_levels: int | None = None
    snapshot_interval_ms: int | None = None
    capture_from: datetime | None = None
    capture_until: datetime | None = None
    capture_window: dict | None = None


@dataclass
class _InstrumentCtx:
    con_id: int
    instrument_id: str
    sec_type: str
    contract: object
    instrument: Instrument
    what_to_show: str
    bar_type: BarType | None = None  # BARS only


def _default_what_to_show(sec_type: str) -> str:
    return "MIDPOINT" if sec_type == "CASH" else "TRADES"


def _what_to_show_for(spec_data_type: str, user_choice: str | None, sec_type: str) -> str:
    if spec_data_type == "TRADE_TICKS":
        return "TRADES"
    if spec_data_type == "QUOTE_TICKS":
        return "BID_ASK"
    return user_choice or _default_what_to_show(sec_type)


def _now_ms() -> int:
    return int(time.time() * 1000)


class JobEngine:
    def __init__(
        self,
        *,
        db: AsyncEngine,
        conn: IBConnectionManager,
        pacing: PacingGate,
        writer: CatalogWriter,
        search: InstrumentSearchService,
        settings: Settings,
        hub: NullHub | None = None,
        throughput: ThroughputTracker | None = None,
    ) -> None:
        self._db = db
        self._conn = conn
        self._pacing = pacing
        self._writer = writer
        self._search = search
        self._settings = settings
        self._hub = hub or NullHub()
        self._tp = throughput or NullThroughput()
        self._runners: dict[str, _JobRunner] = {}

    async def start(self) -> None:
        """Resume after restart: requeue in-flight chunks, restart active jobs."""
        reset = await chunks_repo.reset_active_to_pending(self._db)
        if reset:
            logger.info("Startup recovery: %d in-flight chunks requeued", reset)
        for job in await jobs_repo.list_by_states(self._db, ["queued", "running"]):
            await self._spawn(job)

    async def stop(self) -> None:
        for runner in list(self._runners.values()):
            await runner.stop()
        self._runners.clear()

    # -- job lifecycle -------------------------------------------------------

    async def submit(self, spec: JobSpec) -> tuple[dict, list[str]]:
        if spec.data_type not in DATA_TYPES:
            raise JobValidationError(f"Unsupported data_type {spec.data_type!r}")
        bar_spec: BarSpec | None = None
        if spec.data_type == "BARS":
            if not spec.bar_size:
                raise JobValidationError("bar_size is required for BARS jobs")
            try:
                bar_spec = normalize_bar_size(spec.bar_size)
            except ValueError as exc:
                raise JobValidationError(str(exc)) from exc

        contexts: list[_InstrumentCtx] = []
        for con_id in dict.fromkeys(spec.con_ids):  # dedupe, keep order
            row = await self._search.details(con_id)
            try:
                instrument = instrument_from_row(row)
            except InstrumentConversionError as exc:
                raise JobValidationError(str(exc)) from exc
            what_to_show = _what_to_show_for(spec.data_type, spec.what_to_show, row["sec_type"])
            contexts.append(
                _InstrumentCtx(
                    con_id=con_id,
                    instrument_id=row["instrument_id"],
                    sec_type=row["sec_type"],
                    contract=contract_from_row(row),
                    instrument=instrument,
                    what_to_show=what_to_show,
                    bar_type=BarType.from_str(
                        bar_type_name(row["instrument_id"], bar_spec, what_to_show)
                    )
                    if bar_spec is not None
                    else None,
                )
            )

        if spec.data_type == "DEPTH":
            return await self._submit_depth(spec, contexts)
        if spec.range_end is None:
            raise JobValidationError("end is required for backfill jobs")

        head_timestamps = await self._head_timestamps(contexts, spec.use_rth)
        plan_inputs = [
            InstrumentPlanInput(
                con_id=ctx.con_id,
                instrument_id=ctx.instrument_id,
                sec_type=ctx.sec_type,
                head_timestamp=head_timestamps.get(ctx.con_id),
            )
            for ctx in contexts
        ]
        try:
            if bar_spec is not None:
                planned, warnings = plan_bars(
                    plan_inputs,
                    bar_spec,
                    spec.range_start,
                    spec.range_end,
                    now=datetime.now(UTC),
                    max_chunks=self._settings.max_chunks_per_job,
                )
            else:
                planned, warnings = plan_ticks(
                    plan_inputs,
                    spec.range_start,
                    spec.range_end,
                    now=datetime.now(UTC),
                    max_chunks=self._settings.max_chunks_per_job,
                    stk_window=timedelta(hours=self._settings.tick_chunk_stk_hours),
                    fx_window=timedelta(hours=self._settings.tick_chunk_fx_hours),
                )
        except PlanningError as exc:
            raise JobValidationError(str(exc)) from exc

        if bar_spec is not None:
            params = {
                "bar_size": bar_spec.ib_size,
                "what_to_show": spec.what_to_show,
                "use_rth": spec.use_rth,
            }
            default_name = f"{bar_spec.ib_size} bars x{len(contexts)}"
        else:
            params = {"use_rth": spec.use_rth}
            default_name = f"{spec.data_type.lower()} x{len(contexts)}"

        job_id = str(ULID())
        workers = min(spec.workers or self._settings.default_workers, self._settings.max_workers)
        now_ms = _now_ms()
        job_row = {
            "id": job_id,
            "name": spec.name or default_name,
            "state": "queued",
            "data_type": spec.data_type,
            "params_json": json.dumps(params),
            "workers": workers,
            "max_retries": spec.max_retries,
            "range_start_ns": int(spec.range_start.timestamp() * _NS),
            "range_end_ns": int(spec.range_end.timestamp() * _NS),
            "total_chunks": len(planned),
            "created_at": now_ms,
            "updated_at": now_ms,
        }
        symbol_rows = [
            {
                "job_id": job_id,
                "con_id": ctx.con_id,
                "instrument_id": ctx.instrument_id,
                "ordinal": ordinal,
            }
            for ordinal, ctx in enumerate(contexts)
        ]
        await jobs_repo.insert(self._db, job_row, symbol_rows)
        await chunks_repo.bulk_insert(
            self._db,
            [
                {
                    "job_id": job_id,
                    "con_id": chunk.con_id,
                    "instrument_id": chunk.instrument_id,
                    "seq": chunk.seq,
                    "range_start_ns": chunk.range_start_ns,
                    "range_end_ns": chunk.range_end_ns,
                    "state": "pending",
                }
                for chunk in planned
            ],
        )
        for ctx in contexts:
            await self._writer.ensure_instrument(ctx.instrument)

        job = await jobs_repo.get(self._db, job_id)
        await self._spawn(job)
        return await jobs_repo.get(self._db, job_id), warnings

    async def _submit_depth(
        self, spec: JobSpec, contexts: list[_InstrumentCtx]
    ) -> tuple[dict, list[str]]:
        try:
            CaptureWindow.from_params(spec.capture_window)  # validate early
        except CaptureWindowError as exc:
            raise JobValidationError(str(exc)) from exc
        active = sum(
            runner.instrument_count
            for runner in self._runners.values()
            if isinstance(runner, DepthRecorderRunner)
        )
        budget = self._settings.max_depth_subscriptions
        if active + len(contexts) > budget:
            raise JobValidationError(
                f"Depth subscription budget exceeded: {active} active + {len(contexts)} requested "
                f"> {budget} (max_depth_subscriptions; limited by IB market data lines)"
            )

        job_id = str(ULID())
        now_ms = _now_ms()
        start_at = spec.capture_from or spec.range_start
        job_row = {
            "id": job_id,
            "name": spec.name or f"depth x{len(contexts)}",
            "state": "queued",
            "data_type": "DEPTH",
            "params_json": json.dumps(
                {
                    "depth_levels": spec.depth_levels or self._settings.depth_default_levels,
                    "snapshot_interval_ms": spec.snapshot_interval_ms
                    if spec.snapshot_interval_ms is not None
                    else self._settings.depth_snapshot_interval_ms,
                    "capture_from": spec.capture_from.isoformat() if spec.capture_from else None,
                    "capture_until": spec.capture_until.isoformat() if spec.capture_until else None,
                    "capture_window": spec.capture_window,
                }
            ),
            "workers": 1,
            "max_retries": 0,
            "range_start_ns": int(start_at.timestamp() * _NS),
            "range_end_ns": int(spec.capture_until.timestamp() * _NS) if spec.capture_until else None,
            "total_chunks": 0,
            "created_at": now_ms,
            "updated_at": now_ms,
        }
        symbol_rows = [
            {
                "job_id": job_id,
                "con_id": ctx.con_id,
                "instrument_id": ctx.instrument_id,
                "ordinal": ordinal,
            }
            for ordinal, ctx in enumerate(contexts)
        ]
        await jobs_repo.insert(self._db, job_row, symbol_rows)
        await self._spawn(await self._job_or_raise(job_id))
        return await self._job_or_raise(job_id), []

    async def stop_recorder(self, job_id: str) -> dict:
        """Finalize a DEPTH recorder: flush buffered segments and complete the job."""
        job = await self._job_or_raise(job_id)
        if job["data_type"] != "DEPTH":
            raise JobValidationError("stop applies only to DEPTH recorder jobs")
        runner = self._runners.pop(job_id, None)
        if runner is not None:
            await runner.stop()
        if job["state"] in ("queued", "running", "paused"):
            await jobs_repo.update(self._db, job_id, state="completed", finished_at=_now_ms())
            self._hub.emit_job(job_id, {"state": "completed"})
        return await self._job_or_raise(job_id)

    async def pause(self, job_id: str) -> dict:
        runner = self._runner_or_raise(job_id)
        await runner.pause()
        return await self._job_or_raise(job_id)

    async def resume(self, job_id: str) -> dict:
        job = await self._job_or_raise(job_id)
        runner = self._runners.get(job_id)
        if runner is None and job["state"] == "paused":
            await self._spawn(job)
            runner = self._runners.get(job_id)
        if runner is None:
            raise JobValidationError(f"Job {job_id} is not paused or running")
        await runner.resume()
        return await self._job_or_raise(job_id)

    async def cancel(self, job_id: str) -> dict:
        job = await self._job_or_raise(job_id)
        runner = self._runners.pop(job_id, None)
        if runner is not None:
            await runner.stop()
        if job["state"] in ("queued", "running", "paused"):
            await jobs_repo.update(self._db, job_id, state="canceled", finished_at=_now_ms())
            self._hub.emit_job(job_id, {"state": "canceled"})
        return await self._job_or_raise(job_id)

    async def retry_failed(self, job_id: str) -> dict:
        job = await self._job_or_raise(job_id)
        if job["data_type"] == "DEPTH":
            raise JobValidationError("retry-failed does not apply to DEPTH recorder jobs")
        reset = await chunks_repo.reset_failed_to_pending(self._db, job_id)
        if reset:
            await jobs_repo.bump_counters(self._db, job_id, failed=-reset)
        runner = self._runners.get(job_id)
        if runner is not None:
            runner.enqueue_reset(reset)
        elif job["state"] in ("completed_with_failures", "failed", "canceled", "completed"):
            await jobs_repo.update(self._db, job_id, state="queued", finished_at=None)
            await self._spawn(await self._job_or_raise(job_id))
        return await self._job_or_raise(job_id)

    def runner_active(self, job_id: str) -> bool:
        return job_id in self._runners

    # -- internals -----------------------------------------------------------

    async def _head_timestamps(
        self, contexts: list[_InstrumentCtx], use_rth: bool
    ) -> dict[int, datetime]:
        """Best-effort preflight: earliest available data per instrument."""
        from nautilus_fetch.ib.connection import ConnState

        result: dict[int, datetime] = {}
        if self._conn.state not in (ConnState.CONNECTED, ConnState.DEGRADED):
            return result
        for ctx in contexts:
            try:
                await self._pacing.acquire(
                    cost=1, contract_key=(ctx.con_id, "HEAD", ctx.what_to_show)
                )
                head = await asyncio.wait_for(
                    self._conn.ib.reqHeadTimeStampAsync(
                        ctx.contract, whatToShow=ctx.what_to_show, useRTH=use_rth, formatDate=2
                    ),
                    timeout=15,
                )
                if isinstance(head, datetime):
                    result[ctx.con_id] = head
            except Exception as exc:
                logger.info("Head timestamp unavailable for %s: %s", ctx.instrument_id, exc)
        return result

    def _runner_or_raise(self, job_id: str) -> _JobRunner:
        runner = self._runners.get(job_id)
        if runner is None:
            raise JobValidationError(f"Job {job_id} is not running")
        return runner

    async def _job_or_raise(self, job_id: str) -> dict:
        job = await jobs_repo.get(self._db, job_id)
        if job is None:
            raise JobNotFoundError(f"Job {job_id} not found")
        return job

    async def _spawn(self, job: dict) -> None:
        runner: _JobRunner | DepthRecorderRunner
        if job["data_type"] == "DEPTH":
            runner = DepthRecorderRunner(self, job)
        else:
            runner = _JobRunner(self, job)
        self._runners[job["id"]] = runner
        await runner.start()

    def _runner_finished(self, job_id: str) -> None:
        self._runners.pop(job_id, None)


class _JobRunner:
    def __init__(self, engine: JobEngine, job: dict) -> None:
        self._engine = engine
        self._db = engine._db
        self._settings = engine._settings
        self._hub = engine._hub
        self._job = job
        self._job_id = job["id"]
        self._data_type = job["data_type"]
        self._params = json.loads(job["params_json"])
        self._max_retries = job["max_retries"]
        self._contexts: dict[int, _InstrumentCtx] = {}
        self._spec: BarSpec | None = None  # BARS only

        self._queue: asyncio.Queue[int] = asyncio.Queue()
        self._outstanding = 0
        self._done_event = asyncio.Event()
        self._running = asyncio.Event()  # cleared = paused
        self._running.set()
        self._workers: list[asyncio.Task[None]] = []
        self._supervisor: asyncio.Task[None] | None = None
        self._timers: set[asyncio.TimerHandle] = set()

        self._counters = {
            "done_chunks": job["done_chunks"],
            "empty_chunks": job["empty_chunks"],
            "failed_chunks": job["failed_chunks"],
            "rows_written": job["rows_written"],
            "bytes_written": job["bytes_written"],
        }

    async def start(self) -> None:
        await self._prepare()
        pending = await chunks_repo.pending_of_job(self._db, self._job_id)
        self._outstanding = len(pending)
        now_ms = _now_ms()
        for chunk in pending:
            delay_ms = max(0, (chunk["next_retry_at"] or 0) - now_ms)
            self._schedule(chunk["id"], delay_ms / 1000)

        updates: dict = {"state": "running"}
        if self._job.get("started_at") is None:
            updates["started_at"] = now_ms
        if self._job["state"] == "paused":
            self._running.clear()
            updates["state"] = "paused"
        await jobs_repo.update(self._db, self._job_id, **updates)
        self._hub.emit_job(self._job_id, {"state": updates["state"]})

        self._engine._tp.register(self._job_id)
        worker_count = min(self._job["workers"], self._settings.max_workers)
        self._workers = [
            asyncio.create_task(self._worker(), name=f"job-{self._job_id}-w{i}")
            for i in range(worker_count)
        ]
        self._supervisor = asyncio.create_task(self._supervise(), name=f"job-{self._job_id}")
        if self._outstanding == 0:
            self._done_event.set()

    async def stop(self) -> None:
        for handle in self._timers:
            handle.cancel()
        self._timers.clear()
        tasks = [*self._workers, *([self._supervisor] if self._supervisor else [])]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._workers = []
        self._supervisor = None

    async def pause(self) -> None:
        self._running.clear()
        await jobs_repo.update(self._db, self._job_id, state="paused")
        self._hub.emit_job(self._job_id, {"state": "paused"})

    async def resume(self) -> None:
        self._running.set()
        await jobs_repo.update(self._db, self._job_id, state="running")
        self._hub.emit_job(self._job_id, {"state": "running"})

    def enqueue_reset(self, count: int) -> None:
        """retry-failed while running: failed chunks were reset to pending in DB."""
        if count <= 0:
            return
        self._counters["failed_chunks"] -= count
        self._outstanding += count
        self._done_event.clear()
        asyncio.ensure_future(self._enqueue_pending_retries())

    async def _enqueue_pending_retries(self) -> None:
        pending = await chunks_repo.pending_of_job(self._db, self._job_id)
        queued: set[int] = set(self._queue._queue)  # single-threaded loop access
        for chunk in pending:
            if chunk["id"] not in queued:
                self._queue.put_nowait(chunk["id"])

    # -- execution -----------------------------------------------------------

    async def _prepare(self) -> None:
        if self._data_type == "BARS":
            self._spec = normalize_bar_size(self._params["bar_size"])
        for symbol in await jobs_repo.symbols_of(self._db, self._job_id):
            row = await instruments_repo.get(self._db, symbol["con_id"])
            if row is None:
                raise JobValidationError(
                    f"Instrument conId={symbol['con_id']} missing from cache for job {self._job_id}"
                )
            instrument = instrument_from_row(row)
            what_to_show = _what_to_show_for(
                self._data_type, self._params.get("what_to_show"), row["sec_type"]
            )
            ctx = _InstrumentCtx(
                con_id=symbol["con_id"],
                instrument_id=row["instrument_id"],
                sec_type=row["sec_type"],
                contract=contract_from_row(row),
                instrument=instrument,
                what_to_show=what_to_show,
                bar_type=BarType.from_str(
                    bar_type_name(row["instrument_id"], self._spec, what_to_show)
                )
                if self._spec is not None
                else None,
            )
            self._contexts[ctx.con_id] = ctx
            await self._engine._writer.ensure_instrument(instrument)

    def _schedule(self, chunk_id: int, delay_s: float) -> None:
        if delay_s <= 0:
            self._queue.put_nowait(chunk_id)
            return
        handle = asyncio.get_running_loop().call_later(delay_s, self._queue.put_nowait, chunk_id)
        self._timers.add(handle)

    async def _supervise(self) -> None:
        await self._done_event.wait()
        for task in self._workers:
            task.cancel()
        state = "completed_with_failures" if self._counters["failed_chunks"] > 0 else "completed"
        await jobs_repo.update(self._db, self._job_id, state=state, finished_at=_now_ms())
        self._hub.emit_job(self._job_id, {"state": state, **self._counters})
        self._engine._tp.unregister(self._job_id)
        self._engine._runner_finished(self._job_id)
        logger.info("Job %s finished: %s (%s)", self._job_id, state, self._counters)

    async def _worker(self) -> None:
        while True:
            chunk_id = await self._queue.get()
            try:
                await self._process(chunk_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Unexpected error processing chunk %d", chunk_id)
                await self._on_error(
                    await chunks_repo.get(self._db, chunk_id),
                    ErrorClass.TRANSIENT,
                    None,
                    "internal error (see logs)",
                )

    async def _process(self, chunk_id: int) -> None:
        chunk = await chunks_repo.get(self._db, chunk_id)
        if chunk is None or chunk["state"] not in ("pending", "active"):
            return
        ctx = self._contexts[chunk["con_id"]]

        await self._running.wait()
        await self._engine._conn.ready()
        await chunks_repo.mark_active(self._db, chunk_id)
        self._hub.emit_chunk(self._job_id, chunk["seq"], "active")

        gap = False
        self._engine._tp.track_inflight(self._job_id, +1)
        try:
            if self._data_type == "BARS":
                raw = await self._fetch_bars(chunk, ctx)
            else:
                raw, gap = await self._fetch_ticks(chunk, ctx)
        except RequestError as exc:
            await self._on_error(chunk, classify(exc.code, exc.message), exc.code, exc.message)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._on_error(chunk, ErrorClass.TRANSIENT, None, f"{type(exc).__name__}: {exc}")
            return
        finally:
            self._engine._tp.track_inflight(self._job_id, -1)

        try:
            objs, label_start, label_end = self._convert(raw, chunk, ctx)
            if not objs:
                await self._terminal(chunk, "empty", rows=0, bytes_=0, gap_warning=gap)
                return
            bytes_ = await self._engine._writer.write_chunk(
                objs, label_start_ns=label_start, label_end_ns=label_end
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._on_error(
                chunk, ErrorClass.TRANSIENT, None, f"convert/write: {type(exc).__name__}: {exc}"
            )
            return
        await self._terminal(chunk, "done", rows=len(objs), bytes_=bytes_, gap_warning=gap)

    async def _fetch_bars(self, chunk: dict, ctx: _InstrumentCtx) -> list:
        spec = self._spec
        identical_key = (
            "bars",
            ctx.con_id,
            chunk["range_end_ns"],
            spec.duration,
            spec.ib_size,
            ctx.what_to_show,
        )
        await self._engine._pacing.acquire(
            cost=1,
            identical_key=identical_key,
            contract_key=(ctx.con_id, getattr(ctx.contract, "exchange", ""), ctx.what_to_show),
        )
        ib_bars = await self._engine._conn.ib.reqHistoricalDataAsync(
            ctx.contract,
            endDateTime=chunk_end_datetime(chunk["range_end_ns"]),
            durationStr=spec.duration,
            barSizeSetting=spec.ib_size,
            whatToShow=ctx.what_to_show,
            useRTH=bool(self._params.get("use_rth", True)),
            formatDate=2,
            timeout=self._settings.ib_request_timeout_s,
        )
        return list(ib_bars or [])

    async def _fetch_ticks(self, chunk: dict, ctx: _InstrumentCtx) -> tuple[list, bool]:
        """Cursor through reqHistoricalTicks pages (max 1000 ticks each).

        IB tick times have second resolution: consecutive pages overlap at the
        boundary second (startDateTime is inclusive), deduped positionally. If a
        full page shares one identical second, ticks beyond the first 1000 of
        that second are unreachable — skip ahead one second and flag the gap.
        """
        end_s = chunk["range_end_ns"] // _NS
        cursor_s = chunk["range_start_ns"] // _NS
        cost = 2 if ctx.what_to_show == "BID_ASK" else 1
        contract_key = (ctx.con_id, getattr(ctx.contract, "exchange", ""), ctx.what_to_show)
        raw: list = []
        gap = False

        while True:
            await self._running.wait()
            await self._engine._conn.ready()
            await self._engine._pacing.acquire(
                cost=cost,
                identical_key=("ticks", ctx.con_id, cursor_s, ctx.what_to_show),
                contract_key=contract_key,
            )
            batch = list(
                await self._engine._conn.ib.reqHistoricalTicksAsync(
                    ctx.contract,
                    startDateTime=datetime.fromtimestamp(cursor_s, tz=UTC),
                    endDateTime="",
                    numberOfTicks=1000,
                    whatToShow=ctx.what_to_show,
                    useRth=bool(self._params.get("use_rth", True)),
                    ignoreSize=False,
                )
                or []
            )
            if not batch:
                break

            # positional dedupe of the boundary second we already collected
            have_at_cursor = sum(1 for t in raw if int(t.time.timestamp()) == cursor_s)
            skipped = 0
            for tick in batch:
                if int(tick.time.timestamp()) == cursor_s and skipped < have_at_cursor:
                    skipped += 1
                else:
                    break
            fresh = batch[skipped:]
            raw.extend(t for t in fresh if int(t.time.timestamp()) < end_s)

            if len(batch) < 1000:
                break
            last_s = int(batch[-1].time.timestamp())
            if last_s >= end_s:
                break
            if last_s == cursor_s:
                # 1000+ ticks in one second: cannot page within it
                gap = True
                cursor_s = last_s + 1
            else:
                cursor_s = last_s
        return raw, gap

    def _convert(self, raw: list, chunk: dict, ctx: _InstrumentCtx) -> tuple[list, int, int]:
        """Returns (objects, file_label_start_ns, file_label_end_ns)."""
        start, end = chunk["range_start_ns"], chunk["range_end_ns"]
        if self._data_type == "BARS":
            objs = bars_to_nautilus(
                raw,
                instrument=ctx.instrument,
                bar_type=ctx.bar_type,
                spec=self._spec,
                range_start_ns=start,
                range_end_ns=end,
            )
            return objs, start + 1, end  # bars cover (start, end] in close time
        if self._data_type == "TRADE_TICKS":
            objs = trade_ticks_to_nautilus(
                raw, instrument=ctx.instrument, range_start_ns=start, range_end_ns=end
            )
        else:
            objs = quote_ticks_to_nautilus(
                raw, instrument=ctx.instrument, range_start_ns=start, range_end_ns=end
            )
        return objs, start, end - 1  # ticks cover [start, end)

    async def _terminal(
        self,
        chunk: dict,
        state: str,
        *,
        rows: int = 0,
        bytes_: int = 0,
        error_code: int | None = None,
        error_msg: str | None = None,
        attempts: int | None = None,
        gap_warning: bool = False,
    ) -> None:
        await chunks_repo.mark_terminal(
            self._db,
            chunk["id"],
            state=state,
            rows=rows,
            bytes_=bytes_,
            error_code=error_code,
            error_msg=error_msg,
            attempts=attempts,
            gap_warning=gap_warning,
        )
        bump = {"done": 0, "empty": 0, "failed": 0}
        bump[{"done": "done", "empty": "empty", "failed": "failed"}[state]] = 1
        await jobs_repo.bump_counters(
            self._db, self._job_id, rows=rows, bytes_=bytes_, **bump
        )
        self._counters[f"{state}_chunks"] += 1
        self._counters["rows_written"] += rows
        self._counters["bytes_written"] += bytes_
        self._engine._tp.add(self._job_id, rows, bytes_)
        self._hub.emit_chunk(self._job_id, chunk["seq"], state)
        self._hub.emit_job(self._job_id, dict(self._counters))
        self._outstanding -= 1
        if self._outstanding <= 0:
            self._done_event.set()

    async def _on_error(
        self, chunk: dict | None, error_class: ErrorClass, code: int | None, msg: str
    ) -> None:
        if chunk is None:
            return
        attempt_no = chunk["attempts"] + 1
        await chunks_repo.add_attempt(
            self._db,
            chunk["id"],
            attempt=attempt_no,
            error_code=code,
            error_msg=msg,
            classification=error_class.value,
        )

        if error_class is ErrorClass.EMPTY:
            await self._terminal(chunk, "empty", rows=0, bytes_=0, error_code=code, error_msg=msg)
            return

        if error_class is ErrorClass.PERMANENT:
            hint = HINTS.get(code or 0)
            full_msg = f"{msg} — {hint}" if hint else msg
            await self._terminal(
                chunk, "failed", error_code=code, error_msg=full_msg, attempts=attempt_no
            )
            return

        if error_class is ErrorClass.PACING:
            # IB's counter is truth: drain the gate, requeue without burning an attempt
            self._engine._pacing.report_violation(self._settings.pacing_violation_cooldown_s)
            await chunks_repo.mark_retry(
                self._db,
                chunk["id"],
                attempts=chunk["attempts"],
                next_retry_at_ms=None,
                error_code=code,
                error_msg=msg,
            )
            self._hub.emit_chunk(self._job_id, chunk["seq"], "pending")
            self._schedule(chunk["id"], 0)
            return

        if error_class is ErrorClass.CONNECTIVITY:
            delay_s = 2.0
            await chunks_repo.mark_retry(
                self._db,
                chunk["id"],
                attempts=chunk["attempts"],
                next_retry_at_ms=_now_ms() + int(delay_s * 1000),
                error_code=code,
                error_msg=msg,
            )
            self._hub.emit_chunk(self._job_id, chunk["seq"], "pending")
            self._schedule(chunk["id"], delay_s)
            return

        # TRANSIENT
        attempts = attempt_no
        if attempts > self._max_retries:
            await self._terminal(chunk, "failed", error_code=code, error_msg=msg, attempts=attempts)
            return
        backoff = min(
            self._settings.retry_backoff_base_s * (2**attempts),
            self._settings.retry_backoff_max_s,
        ) * random.uniform(0.8, 1.2)
        await chunks_repo.mark_retry(
            self._db,
            chunk["id"],
            attempts=attempts,
            next_retry_at_ms=_now_ms() + int(backoff * 1000),
            error_code=code,
            error_msg=msg,
        )
        self._hub.emit_chunk(self._job_id, chunk["seq"], "pending")
        self._schedule(chunk["id"], backoff)
