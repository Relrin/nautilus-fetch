"""Instrument discovery: symbol search and contract details with a DB cache."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.repos import instruments as instruments_repo
from nautilus_fetch.ib.connection import ConnState, IBConnectionManager
from nautilus_fetch.ib.serialize import to_jsonable
from nautilus_fetch.ib.shim import derive_instrument_id

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_S = 15.0
_FOREX_EXCHANGE = "IDEALPRO"

# ISO 4217 codes IB quotes forex against. Used to recognize currency-pair
# queries; anything outside this set is treated as a normal symbol search.
_CURRENCIES = frozenset(
    {
        "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "CNH", "HKD",
        "SGD", "SEK", "NOK", "DKK", "MXN", "ZAR", "PLN", "CZK", "HUF", "TRY",
        "ILS", "KRW", "RUB", "INR", "CNY", "THB", "AED", "SAR",
    }
)

_FOREX_SEPARATOR = re.compile(r"[./\-\s_]+")


def parse_forex_query(query: str) -> tuple[str, str | None] | None:
    """Detect a currency-pair query, returning (base, quote|None), or None.

    Accepts separated pairs ('EUR.USD', 'EUR/USD', 'EUR-USD'), concatenated
    pairs ('EURUSD'), and a bare base currency ('EUR' -> every EUR pair).
    Only recognized ISO 4217 codes qualify, so ordinary stock tickers that
    happen to be 3 or 6 letters are left to the normal symbol search.
    """
    raw = query.strip().upper()
    if not raw:
        return None
    parts = [part for part in _FOREX_SEPARATOR.split(raw) if part]
    if len(parts) == 2:
        base, quote = parts
        if base in _CURRENCIES and quote in _CURRENCIES:
            return base, quote
        return None
    if len(parts) == 1:
        token = parts[0]
        if len(token) == 6 and token[:3] in _CURRENCIES and token[3:] in _CURRENCIES:
            return token[:3], token[3:]
        if len(token) == 3 and token in _CURRENCIES:
            return token, None
    return None


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
        results: list[dict[str, Any]] = []
        seen: set[int] = set()

        # IB's reqMatchingSymbols only returns stock-type matches; forex pairs
        # (secType CASH on IDEALPRO) never appear there and must be resolved via
        # contract details instead.
        forex = parse_forex_query(query)
        if forex is not None and sec_type in (None, "CASH"):
            for row in await self._search_forex(*forex):
                if row["con_id"] not in seen:
                    seen.add(row["con_id"])
                    results.append(row)

        # Skip the stock search for an explicit pair query (e.g. "EUR.USD"):
        # reqMatchingSymbols would only add noise. A bare currency ("EUR") is
        # ambiguous, so still run it — the base may also be a ticker.
        explicit_pair = forex is not None and forex[1] is not None
        if sec_type != "CASH" and not (explicit_pair and sec_type is None):
            for row in await self._search_symbols(query, sec_type):
                if row["con_id"] not in seen:
                    seen.add(row["con_id"])
                    results.append(row)

        return results

    async def _search_symbols(self, query: str, sec_type: str | None) -> list[dict[str, Any]]:
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

    async def _search_forex(self, base: str, quote: str | None) -> list[dict[str, Any]]:
        """Resolve currency pairs through an underspecified CASH contract.

        With only symbol+exchange, IB returns every pair based on `base`;
        adding `currency` narrows it to the single requested pair.
        """
        from ib_async import Contract

        contract = Contract(secType="CASH", symbol=base, exchange=_FOREX_EXCHANGE)
        if quote is not None:
            contract.currency = quote
        await self._search_limiter.acquire()
        try:
            details_list = await asyncio.wait_for(
                self._conn.ib.reqContractDetailsAsync(contract),
                timeout=_REQUEST_TIMEOUT_S,
            )
        except Exception as exc:  # "no security definition" etc. -> no matches
            logger.info("Forex lookup for %s%s failed: %s", base, quote or "", exc)
            return []

        results = []
        for details in details_list or []:
            contract = details.contract
            results.append(
                {
                    "con_id": contract.conId,
                    "symbol": contract.symbol,
                    "sec_type": contract.secType,
                    "primary_exchange": contract.primaryExchange or None,
                    "currency": contract.currency or None,
                    "description": details.longName or f"{contract.symbol}.{contract.currency}",
                    "derivative_sec_types": [],
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
