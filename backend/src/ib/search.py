"""Instrument discovery: symbol search and contract details with a DB cache."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.repos import instruments as instruments_repo
from nautilus_fetch.ib.connection import ConnState, IBConnectionManager
from nautilus_fetch.ib.serialize import to_jsonable
from nautilus_fetch.ib.shim import derive_instrument_id

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_S = 15.0


class IBUnavailableError(RuntimeError):
    """IB gateway is not connected and the request cannot be served from cache."""


class InstrumentNotFoundError(LookupError):
    pass


class MinIntervalLimiter:
    """Serializes calls so that consecutive acquisitions are at least min_interval apart.

    IB paces reqMatchingSymbols at ~1 request/second — separate from the
    historical-data pacing budget, hence not part of PacingGate.
    """

    def __init__(self, min_interval_s: float, *, now=time.monotonic) -> None:
        self._min_interval_s = min_interval_s
        self._now = now
        self._last = -float("inf")
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            wait = self._last + self._min_interval_s - self._now()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = self._now()


class InstrumentSearchService:
    def __init__(
        self,
        conn: IBConnectionManager,
        db: AsyncEngine,
        *,
        cache_ttl_s: float = 7 * 86_400,
        search_min_interval_s: float = 1.0,
    ) -> None:
        self._conn = conn
        self._db = db
        self._cache_ttl_ms = int(cache_ttl_s * 1000)
        self._search_limiter = MinIntervalLimiter(search_min_interval_s)

    def _require_connection(self) -> None:
        if self._conn.state not in (ConnState.CONNECTED, ConnState.DEGRADED):
            raise IBUnavailableError("IB gateway is not connected")

    async def search(self, query: str, sec_type: str | None = None) -> list[dict[str, Any]]:
        self._require_connection()
        await self._search_limiter.acquire()
        descriptions = await asyncio.wait_for(
            self._conn.ib.reqMatchingSymbolsAsync(query),
            timeout=_REQUEST_TIMEOUT_S,
        )
        results = []
        for description in descriptions or []:
            contract = description.contract
            derivative_sec_types = list(description.derivativeSecTypes or [])
            if sec_type and sec_type != contract.secType and sec_type not in derivative_sec_types:
                continue
            results.append(
                {
                    "con_id": contract.conId,
                    "symbol": contract.symbol,
                    "sec_type": contract.secType,
                    "primary_exchange": contract.primaryExchange or None,
                    "currency": contract.currency or None,
                    "description": contract.description or None,
                    "derivative_sec_types": derivative_sec_types,
                }
            )
        return results

    async def details(self, con_id: int, *, refresh: bool = False) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        if not refresh:
            cached = await instruments_repo.get(self._db, con_id)
            if cached is not None and cached["refreshed_at"] is not None:
                if now_ms - cached["refreshed_at"] <= self._cache_ttl_ms:
                    return cached

        self._require_connection()
        from ib_async import Contract

        details_list = await asyncio.wait_for(
            self._conn.ib.reqContractDetailsAsync(Contract(conId=con_id)),
            timeout=_REQUEST_TIMEOUT_S,
        )
        if not details_list:
            raise InstrumentNotFoundError(f"IB returned no contract details for conId={con_id}")

        details = details_list[0]
        contract = details.contract
        row = {
            "con_id": contract.conId,
            "symbol": contract.symbol,
            "sec_type": contract.secType,
            "exchange": contract.exchange or None,
            "primary_exchange": contract.primaryExchange or None,
            "currency": contract.currency or None,
            "description": details.longName or None,
            "instrument_id": derive_instrument_id(details),
            "details_json": json.dumps(to_jsonable(details)),
            "refreshed_at": now_ms,
        }
        await instruments_repo.upsert(self._db, row)
        return row
