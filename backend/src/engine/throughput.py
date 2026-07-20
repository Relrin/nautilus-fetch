"""Per-job throughput sampling: rows/s, bytes/s, in-flight requests.

One asyncio task samples all registered (running) jobs at a fixed interval into
an in-memory ring buffer, pushes WS "tp" frames, and persists every Nth sample
to the throughput_samples table (pruned beyond the retention window) so the
sparkline survives restarts and can be served for finished jobs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.api.ws import NullHub
from nautilus_fetch.db.repos import samples as samples_repo

logger = logging.getLogger(__name__)


class NullThroughput:
    """No-op tracker for tests and headless engine use."""

    def register(self, job_id: str) -> None: ...

    def unregister(self, job_id: str) -> None: ...

    def add(self, job_id: str, rows: int, bytes_: int) -> None: ...

    def track_inflight(self, job_id: str, delta: int) -> None: ...

    def recent(self, job_id: str, window_s: float) -> list[dict[str, Any]] | None:
        return None


@dataclass
class _JobTp:
    rows_acc: int = 0
    bytes_acc: int = 0
    inflight: int = 0
    ring: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=600))
    sample_count: int = 0


class ThroughputTracker:
    def __init__(
        self,
        db: AsyncEngine,
        hub: NullHub | None = None,
        *,
        interval_s: float = 1.0,
        persist_every: int = 5,
        retention_h: float = 24.0,
    ) -> None:
        self._db = db
        self._hub = hub or NullHub()
        self._interval_s = interval_s
        self._persist_every = max(1, persist_every)
        self._retention_ms = int(retention_h * 3600 * 1000)
        self._jobs: dict[str, _JobTp] = {}
        self._task: asyncio.Task[None] | None = None
        self._last_prune = 0.0

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="throughput-sampler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def register(self, job_id: str) -> None:
        self._jobs.setdefault(job_id, _JobTp())

    def unregister(self, job_id: str) -> None:
        tp = self._jobs.pop(job_id, None)
        if tp is None or (tp.rows_acc == 0 and tp.bytes_acc == 0):
            return
        # flush work accumulated since the last tick, or fast jobs that finish
        # between ticks would show no throughput at all
        final = {
            "job_id": job_id,
            "ts": int(time.time() * 1000),
            "rows_per_s": tp.rows_acc / self._interval_s,
            "bytes_per_s": tp.bytes_acc / self._interval_s,
            "inflight": 0,
        }
        asyncio.get_running_loop().create_task(samples_repo.insert_many(self._db, [final]))

    def add(self, job_id: str, rows: int, bytes_: int) -> None:
        tp = self._jobs.get(job_id)
        if tp is not None:
            tp.rows_acc += rows
            tp.bytes_acc += bytes_

    def track_inflight(self, job_id: str, delta: int) -> None:
        tp = self._jobs.get(job_id)
        if tp is not None:
            tp.inflight = max(0, tp.inflight + delta)

    def recent(self, job_id: str, window_s: float) -> list[dict[str, Any]] | None:
        """Ring-buffer samples for an actively tracked job, else None."""
        tp = self._jobs.get(job_id)
        if tp is None:
            return None
        since_ms = int((time.time() - window_s) * 1000)
        return [sample for sample in tp.ring if sample["ts"] >= since_ms]

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval_s)
            now_ms = int(time.time() * 1000)
            to_persist: list[dict[str, Any]] = []
            for job_id, tp in self._jobs.items():
                sample = {
                    "ts": now_ms,
                    "rows_per_s": tp.rows_acc / self._interval_s,
                    "bytes_per_s": tp.bytes_acc / self._interval_s,
                    "inflight": tp.inflight,
                }
                tp.rows_acc = 0
                tp.bytes_acc = 0
                tp.ring.append(sample)
                tp.sample_count += 1
                self._hub.emit_tp(
                    job_id, now_ms, sample["rows_per_s"], sample["bytes_per_s"] / 1_000_000
                )
                if tp.sample_count % self._persist_every == 0:
                    to_persist.append({"job_id": job_id, **sample})
            try:
                if to_persist:
                    await samples_repo.insert_many(self._db, to_persist)
                if time.monotonic() - self._last_prune > 3600:
                    self._last_prune = time.monotonic()
                    await samples_repo.prune(self._db, now_ms - self._retention_ms)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Throughput persistence failed")
