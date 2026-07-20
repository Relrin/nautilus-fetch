"""Single multiplexed WebSocket channel pushing job/chunk deltas to all clients.

Frames are coalesced per batch window (default 500 ms):
  {"t": "job",    "id": <job_id>, "patch": {...}}
  {"t": "chunks", "job": <job_id>, "cells": [[seq, code], ...]}
  {"t": "tp",     "job": <job_id>, "ts": ..., "rows_s": ..., "mb_s": ...}

Events are advisory — clients re-sync via REST after (re)connecting.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

CHUNK_STATE_CODES: dict[str, int] = {"pending": 0, "active": 1, "done": 2, "empty": 3, "failed": 4}


class NullHub:
    """No-op hub for tests and headless engine use."""

    def emit_job(self, job_id: str, patch: dict[str, Any]) -> None: ...

    def emit_chunk(self, job_id: str, seq: int, state: str) -> None: ...

    def emit_tp(self, job_id: str, ts_ms: int, rows_s: float, mb_s: float) -> None: ...


class WsHub(NullHub):
    def __init__(self, batch_ms: int = 500) -> None:
        self._batch_s = batch_ms / 1000
        self._clients: set[WebSocket] = set()
        self._job_patches: dict[str, dict[str, Any]] = {}
        self._chunk_cells: dict[str, dict[int, int]] = {}
        self._tp_frames: list[dict[str, Any]] = []
        self._dirty = asyncio.Event()
        self._flush_task: asyncio.Task[None] | None = None

    def emit_job(self, job_id: str, patch: dict[str, Any]) -> None:
        self._job_patches.setdefault(job_id, {}).update(patch)
        self._dirty.set()

    def emit_chunk(self, job_id: str, seq: int, state: str) -> None:
        self._chunk_cells.setdefault(job_id, {})[seq] = CHUNK_STATE_CODES[state]
        self._dirty.set()

    def emit_tp(self, job_id: str, ts_ms: int, rows_s: float, mb_s: float) -> None:
        self._tp_frames.append({"t": "tp", "job": job_id, "ts": ts_ms, "rows_s": rows_s, "mb_s": mb_s})
        self._dirty.set()

    async def start(self) -> None:
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._flush_loop(), name="ws-hub-flush")

    async def stop(self) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None

    async def handle(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        try:
            while True:
                await websocket.receive_text()  # client messages are ignored
        except WebSocketDisconnect:
            pass
        finally:
            self._clients.discard(websocket)

    def _drain_frames(self) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        for job_id, patch in self._job_patches.items():
            frames.append({"t": "job", "id": job_id, "patch": patch})
        for job_id, cells in self._chunk_cells.items():
            frames.append({"t": "chunks", "job": job_id, "cells": sorted(cells.items())})
        frames.extend(self._tp_frames)
        self._job_patches = {}
        self._chunk_cells = {}
        self._tp_frames = []
        return frames

    async def _flush_loop(self) -> None:
        while True:
            await self._dirty.wait()
            await asyncio.sleep(self._batch_s)  # coalesce a batch window
            self._dirty.clear()
            frames = self._drain_frames()
            if not frames or not self._clients:
                continue
            dead: list[WebSocket] = []
            for client in self._clients:
                try:
                    for frame in frames:
                        await client.send_json(frame)
                except Exception:
                    dead.append(client)
            for client in dead:
                self._clients.discard(client)
