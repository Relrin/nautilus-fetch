"""Live L2 depth recorder: reqMktDepth subscriptions -> OrderBookDepth10 segments.

IB has no historical depth API, so DEPTH jobs are streaming recorders, not
backfills: they capture only while running. Snapshots of the in-memory book are
taken on a fixed cadence (or on every book update when the interval is 0),
buffered, and flushed to the catalog every flush interval — each flushed
segment becomes a `done` chunk so progress, throughput, and the chunk map reuse
the same machinery as download jobs.

Optional capture windows:
- capture_from / capture_until: absolute datetimes bounding the whole recorder
- capture_window: a recurring daily window (time-of-day range + timezone +
  weekdays); the recorder subscribes at open, flushes and unsubscribes at
  close, and idles in between.

A disconnect (or a process restart) flushes/starts a segment flagged with
gap_warning: the stream has a hole there by nature.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from datetime import time as dtime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from nautilus_trader.model.data import BookOrder, OrderBookDepth10
from nautilus_trader.model.enums import OrderSide
from nautilus_trader.model.instruments import Instrument

from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import instruments as instruments_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.engine.convert import contract_from_row, instrument_from_row
from nautilus_fetch.ib.connection import ConnState

if TYPE_CHECKING:
    from nautilus_fetch.engine.engine import JobEngine

logger = logging.getLogger(__name__)

_NS = 1_000_000_000
DEPTH_LEVELS = 10  # OrderBookDepth10 is fixed at 10 levels per side


class CaptureWindowError(ValueError):
    pass


@dataclass(frozen=True)
class CaptureWindow:
    start: dtime
    end: dtime
    tz: ZoneInfo
    days: frozenset[int]  # 0=Mon .. 6=Sun

    @classmethod
    def from_params(cls, data: dict[str, Any] | None) -> CaptureWindow | None:
        if not data:
            return None
        try:
            start = dtime.fromisoformat(data["start"])
            end = dtime.fromisoformat(data["end"])
            tz = ZoneInfo(data.get("tz") or "UTC")
        except (KeyError, ValueError) as exc:
            raise CaptureWindowError(f"Invalid capture_window: {exc}") from exc
        if end <= start:
            raise CaptureWindowError("capture_window end must be after start (no overnight windows)")
        days = frozenset(data.get("days") or range(5))
        if not days or not days <= set(range(7)):
            raise CaptureWindowError("capture_window days must be within 0 (Mon) .. 6 (Sun)")
        return cls(start=start, end=end, tz=tz, days=days)

    def contains(self, now: datetime) -> bool:
        local = now.astimezone(self.tz)
        return local.weekday() in self.days and self.start <= local.time() < self.end

    def seconds_until_open(self, now: datetime) -> float:
        if self.contains(now):
            return 0.0
        local = now.astimezone(self.tz)
        for day_offset in range(8):
            candidate_date = (local + _days(day_offset)).date()
            if candidate_date.weekday() not in self.days:
                continue
            candidate = datetime.combine(candidate_date, self.start, tzinfo=self.tz)
            if candidate > local:
                return (candidate - local).total_seconds()
        raise CaptureWindowError("capture_window never opens")  # unreachable with valid days


def _days(n: int):
    from datetime import timedelta

    return timedelta(days=n)


def book_to_depth10(
    instrument: Instrument,
    bids: list[Any],
    asks: list[Any],
    *,
    sequence: int,
    ts_ns: int,
) -> OrderBookDepth10:
    """DOM levels (objects with .price/.size) -> padded 10-level snapshot."""

    def orders(levels: list[Any], side: OrderSide) -> tuple[list[BookOrder], list[int]]:
        out: list[BookOrder] = []
        counts: list[int] = []
        for level in levels[:DEPTH_LEVELS]:
            price = float(level.price)
            size = float(level.size)
            if price <= 0:
                continue
            out.append(
                BookOrder(side, instrument.make_price(price), instrument.make_qty(max(size, 0.0)), 0)
            )
            counts.append(1)
        pad = BookOrder(side, instrument.price_increment, instrument.make_qty(0), 0)
        while len(out) < DEPTH_LEVELS:
            out.append(pad)
            counts.append(0)
        return out, counts

    bid_orders, bid_counts = orders(bids, OrderSide.BUY)
    ask_orders, ask_counts = orders(asks, OrderSide.SELL)
    return OrderBookDepth10(
        instrument_id=instrument.id,
        bids=bid_orders,
        asks=ask_orders,
        bid_counts=bid_counts,
        ask_counts=ask_counts,
        flags=0,
        sequence=sequence,
        ts_event=ts_ns,
        ts_init=ts_ns,
    )


@dataclass
class _DepthCtx:
    con_id: int
    instrument_id: str
    contract: object
    instrument: Instrument
    ticker: Any | None = None
    update_handler: Any | None = None
    buffer: list[OrderBookDepth10] = field(default_factory=list)
    sequence: int = 0


class DepthRecorderRunner:
    """One per DEPTH job; owns the depth subscriptions of all its instruments."""

    def __init__(self, engine: JobEngine, job: dict) -> None:
        self._engine = engine
        self._db = engine._db
        self._settings = engine._settings
        self._hub = engine._hub
        self._job = job
        self._job_id = job["id"]
        params = json.loads(job["params_json"])
        self._levels = int(params.get("depth_levels") or engine._settings.depth_default_levels)
        self._interval_s = (
            int(params.get("snapshot_interval_ms") or engine._settings.depth_snapshot_interval_ms)
            / 1000
        )
        self._flush_interval_s = self._settings.depth_flush_interval_s
        self._capture_from = _parse_dt(params.get("capture_from"))
        self._capture_until = _parse_dt(params.get("capture_until"))
        self._window = CaptureWindow.from_params(params.get("capture_window"))

        self._contexts: dict[int, _DepthCtx] = {}
        self._subscribed = False
        self._running = asyncio.Event()  # cleared = paused
        self._running.set()
        self._task: asyncio.Task[None] | None = None
        self._next_seq = 0
        self._last_flush = time.monotonic()
        # a restart or reconnect means the stream has a hole: flag next segment
        self._gap_pending = job["done_chunks"] > 0  # resumed job -> gap
        self._counters = {
            "done_chunks": job["done_chunks"],
            "rows_written": job["rows_written"],
            "bytes_written": job["bytes_written"],
        }

    @property
    def instrument_count(self) -> int:
        return len(self._contexts)

    async def start(self) -> None:
        await self._prepare()
        self._next_seq = (await chunks_repo.max_seq(self._db, self._job_id)) + 1
        updates: dict = {"state": "running"}
        if self._job.get("started_at") is None:
            updates["started_at"] = int(time.time() * 1000)
        if self._job["state"] == "paused":
            self._running.clear()
            updates["state"] = "paused"
        await jobs_repo.update(self._db, self._job_id, **updates)
        self._hub.emit_job(self._job_id, {"state": updates["state"]})
        self._engine._tp.register(self._job_id)
        self._task = asyncio.create_task(self._run(), name=f"depth-{self._job_id}")

    async def stop(self) -> None:
        """Graceful halt: flush buffers, unsubscribe, keep job state untouched."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._flush_all()
        self._unsubscribe()
        self._engine._tp.unregister(self._job_id)

    async def pause(self) -> None:
        self._running.clear()
        await self._flush_all()
        self._unsubscribe()
        await jobs_repo.update(self._db, self._job_id, state="paused")
        self._hub.emit_job(self._job_id, {"state": "paused"})

    async def resume(self) -> None:
        self._running.set()
        await jobs_repo.update(self._db, self._job_id, state="running")
        self._hub.emit_job(self._job_id, {"state": "running"})

    def enqueue_reset(self, count: int) -> None:  # retry-failed does not apply
        return

    # -- internals -----------------------------------------------------------

    async def _prepare(self) -> None:
        for symbol in await jobs_repo.symbols_of(self._db, self._job_id):
            row = await instruments_repo.get(self._db, symbol["con_id"])
            if row is None:
                raise RuntimeError(f"Instrument conId={symbol['con_id']} missing from cache")
            instrument = instrument_from_row(row)
            self._contexts[symbol["con_id"]] = _DepthCtx(
                con_id=symbol["con_id"],
                instrument_id=row["instrument_id"],
                contract=contract_from_row(row),
                instrument=instrument,
            )
            await self._engine._writer.ensure_instrument(instrument)

    async def _run(self) -> None:
        try:
            while True:
                now = datetime.now(UTC)
                if self._capture_until is not None and now >= self._capture_until:
                    await self._finalize("completed")
                    return
                if not self._running.is_set():
                    await self._running.wait()
                    continue
                if self._capture_from is not None and now < self._capture_from:
                    await asyncio.sleep(min(1.0, (self._capture_from - now).total_seconds()))
                    continue
                if self._engine._conn.state not in (ConnState.CONNECTED, ConnState.DEGRADED):
                    if self._subscribed:
                        await self._flush_all(gap=True)
                        self._unsubscribe()
                        self._gap_pending = True
                    await asyncio.sleep(1.0)
                    continue
                if self._window is not None and not self._window.contains(now):
                    if self._subscribed:
                        await self._flush_all()
                        self._unsubscribe()
                    await asyncio.sleep(min(self._window.seconds_until_open(now), 5.0))
                    continue

                if not self._subscribed:
                    self._subscribe()
                if self._interval_s > 0:
                    self._snapshot_all()
                if time.monotonic() - self._last_flush >= self._flush_interval_s:
                    await self._flush_all()
                await asyncio.sleep(self._interval_s if self._interval_s > 0 else 0.2)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Depth recorder %s crashed", self._job_id)
            await jobs_repo.update(
                self._db, self._job_id, state="failed", error="recorder crashed (see logs)"
            )
            self._hub.emit_job(self._job_id, {"state": "failed"})
            self._engine._runner_finished(self._job_id)

    def _subscribe(self) -> None:
        for ctx in self._contexts.values():
            smart_depth = getattr(ctx.contract, "exchange", "") == "SMART"
            ctx.ticker = self._engine._conn.ib.reqMktDepth(
                ctx.contract, numRows=self._levels, isSmartDepth=smart_depth
            )
            if self._interval_s <= 0:  # event-driven: snapshot on every update
                handler = self._make_update_handler(ctx)
                ctx.ticker.updateEvent += handler
                ctx.update_handler = handler
        self._subscribed = True
        logger.info("Depth recorder %s subscribed (%d instruments)", self._job_id, len(self._contexts))

    def _unsubscribe(self) -> None:
        if not self._subscribed:
            return
        for ctx in self._contexts.values():
            if ctx.ticker is not None and ctx.update_handler is not None:
                ctx.ticker.updateEvent -= ctx.update_handler
                ctx.update_handler = None
            try:
                smart_depth = getattr(ctx.contract, "exchange", "") == "SMART"
                self._engine._conn.ib.cancelMktDepth(ctx.contract, isSmartDepth=smart_depth)
            except Exception:
                logger.debug("cancelMktDepth failed for %s", ctx.instrument_id, exc_info=True)
            ctx.ticker = None
        self._subscribed = False

    def _make_update_handler(self, ctx: _DepthCtx):
        def on_update(_ticker: Any = None, *args: Any) -> None:
            self._snapshot(ctx)

        return on_update

    def _snapshot_all(self) -> None:
        for ctx in self._contexts.values():
            self._snapshot(ctx)

    def _snapshot(self, ctx: _DepthCtx) -> None:
        if ctx.ticker is None:
            return
        bids = list(ctx.ticker.domBids or [])
        asks = list(ctx.ticker.domAsks or [])
        if not bids and not asks:
            return  # nothing received yet
        ctx.sequence += 1
        ctx.buffer.append(
            book_to_depth10(
                ctx.instrument, bids, asks, sequence=ctx.sequence, ts_ns=time.time_ns()
            )
        )

    async def _flush_all(self, gap: bool = False) -> None:
        self._last_flush = time.monotonic()
        gap_flag = gap or self._gap_pending
        flushed_any = False
        for ctx in self._contexts.values():
            if not ctx.buffer:
                continue
            snapshots = ctx.buffer
            ctx.buffer = []
            start_ns = snapshots[0].ts_event
            end_ns = snapshots[-1].ts_event
            bytes_ = await self._engine._writer.write_chunk(
                snapshots, label_start_ns=start_ns, label_end_ns=end_ns
            )
            seq = self._next_seq
            self._next_seq += 1
            now_ms = int(time.time() * 1000)
            await chunks_repo.bulk_insert(
                self._db,
                [
                    {
                        "job_id": self._job_id,
                        "con_id": ctx.con_id,
                        "instrument_id": ctx.instrument_id,
                        "seq": seq,
                        "range_start_ns": start_ns,
                        "range_end_ns": end_ns + 1,
                        "state": "done",
                        "rows": len(snapshots),
                        "bytes": bytes_,
                        "gap_warning": 1 if gap_flag else 0,
                        "started_at": now_ms,
                        "finished_at": now_ms,
                    }
                ],
            )
            await jobs_repo.bump_counters(
                self._db, self._job_id, done=1, total=1, rows=len(snapshots), bytes_=bytes_
            )
            self._counters["done_chunks"] += 1
            self._counters["rows_written"] += len(snapshots)
            self._counters["bytes_written"] += bytes_
            self._engine._tp.add(self._job_id, len(snapshots), bytes_)
            self._hub.emit_chunk(self._job_id, seq, "done")
            self._hub.emit_job(self._job_id, dict(self._counters))
            flushed_any = True
        if flushed_any:
            self._gap_pending = False

    async def _finalize(self, state: str) -> None:
        await self._flush_all()
        self._unsubscribe()
        await jobs_repo.update(
            self._db, self._job_id, state=state, finished_at=int(time.time() * 1000)
        )
        self._hub.emit_job(self._job_id, {"state": state, **self._counters})
        self._engine._tp.unregister(self._job_id)
        self._engine._runner_finished(self._job_id)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
