"""Single-socket IB Gateway connection with reconnect and error fan-out.

Exactly one ``ib_async.IB`` instance (one client id) exists per process. All
download concurrency happens at the request-scheduling level above this class;
workers gate on :meth:`IBConnectionManager.ready` before every wire request.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from enum import StrEnum
from typing import Any

from .errors import ErrorClass, classify

logger = logging.getLogger(__name__)

# Codes that flip a live connection into/out of DEGRADED (data farm outages,
# broken gateway<->IB links) without the socket itself dropping.
_DEGRADE_CODES = {1100, 2103, 2105, 2110}
_RESTORE_CODES = {1101, 1102, 2104, 2106, 2107, 2158}

ErrorListener = Callable[[int, int, str, ErrorClass, Any], None]


class ConnState(StrEnum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DEGRADED = "degraded"


class IBConnectionManager:
    def __init__(
        self,
        host: str,
        port: int,
        client_id: int,
        *,
        connect_timeout_s: float = 10.0,
        backoff_initial_s: float = 2.0,
        backoff_max_s: float = 60.0,
        ib: Any | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._client_id = client_id
        self._connect_timeout_s = connect_timeout_s
        self._backoff_initial_s = backoff_initial_s
        self._backoff_max_s = backoff_max_s

        # Created lazily inside the running loop unless injected (tests).
        self._ib = ib
        self._state = ConnState.DISCONNECTED
        self._ready = asyncio.Event()
        self._disconnected: asyncio.Event | None = None
        self._run_task: asyncio.Task[None] | None = None
        self._stopping = False

        self._connected_since: float | None = None
        self._reconnect_attempts = 0
        self._last_error: str | None = None
        self._last_ib_error: dict[str, Any] | None = None
        self._error_listeners: list[ErrorListener] = []

    @property
    def ib(self) -> Any:
        if self._ib is None:
            raise RuntimeError("IB connection not started")
        return self._ib

    @property
    def state(self) -> ConnState:
        return self._state

    def on_error(self, listener: ErrorListener) -> None:
        """Register a listener for IB error events: (req_id, code, msg, class, contract)."""
        self._error_listeners.append(listener)

    async def start(self) -> None:
        if self._run_task is not None:
            return
        if self._ib is None:
            from ib_async import IB

            self._ib = IB()
        # Fail request futures with RequestError(code, message) instead of
        # silently returning empty results — the engine's failure classifier
        # depends on seeing the IB error code.
        self._ib.RaiseRequestErrors = True
        self._ib.disconnectedEvent += self._on_disconnected
        self._ib.errorEvent += self._on_error_event
        self._stopping = False
        self._run_task = asyncio.create_task(self._run(), name="ib-connection")

    async def stop(self) -> None:
        self._stopping = True
        if self._run_task is not None:
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass
            self._run_task = None
        if self._ib is not None and self._ib.isConnected():
            self._ib.disconnect()
        self._set_state(ConnState.DISCONNECTED)
        self._ready.clear()

    async def ready(self) -> None:
        """Block until the connection is usable. Workers call this before every request."""
        await self._ready.wait()

    def status(self) -> dict[str, Any]:
        server_version: int | None = None
        if self._ib is not None and self._ib.isConnected():
            try:
                server_version = self._ib.client.serverVersion()
            except Exception:
                server_version = None
        return {
            "state": self._state.value,
            "host": self._host,
            "port": self._port,
            "client_id": self._client_id,
            "connected_since": self._connected_since,
            "reconnect_attempts": self._reconnect_attempts,
            "server_version": server_version,
            "last_error": self._last_error,
            "last_ib_error": self._last_ib_error,
        }

    async def _run(self) -> None:
        backoff = self._backoff_initial_s
        while not self._stopping:
            self._set_state(ConnState.CONNECTING)
            try:
                await self._ib.connectAsync(
                    self._host,
                    self._port,
                    clientId=self._client_id,
                    timeout=self._connect_timeout_s,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # refused, timeout, handshake failure, ...
                self._last_error = f"{type(exc).__name__}: {exc}"
                self._reconnect_attempts += 1
                self._set_state(ConnState.DISCONNECTED)
                logger.warning(
                    "IB connect to %s:%s failed (%s); retrying in %.0fs",
                    self._host,
                    self._port,
                    self._last_error,
                    backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self._backoff_max_s)
                continue

            backoff = self._backoff_initial_s
            self._connected_since = time.time()
            self._last_error = None
            self._disconnected = asyncio.Event()
            self._set_state(ConnState.CONNECTED)
            self._ready.set()
            logger.info("IB connected to %s:%s (client id %s)", self._host, self._port, self._client_id)

            await self._disconnected.wait()
            self._ready.clear()
            self._connected_since = None
            if not self._stopping:
                self._reconnect_attempts += 1
                self._set_state(ConnState.DISCONNECTED)
                logger.warning("IB disconnected; reconnecting in %.0fs", backoff)
                await asyncio.sleep(backoff)

    def _set_state(self, state: ConnState) -> None:
        self._state = state

    def _on_disconnected(self) -> None:
        if self._disconnected is not None:
            self._disconnected.set()

    def _on_error_event(self, req_id: int, code: int, message: str, contract: Any = None, *args: Any) -> None:
        error_class = classify(code, message)
        if error_class is not ErrorClass.INFO:
            self._last_ib_error = {"req_id": req_id, "code": code, "message": message, "ts": time.time()}
        if code in _DEGRADE_CODES and self._state is ConnState.CONNECTED:
            self._set_state(ConnState.DEGRADED)
        elif code in _RESTORE_CODES and self._state is ConnState.DEGRADED:
            self._set_state(ConnState.CONNECTED)
        for listener in self._error_listeners:
            try:
                listener(req_id, code, message, error_class, contract)
            except Exception:
                logger.exception("IB error listener raised")
