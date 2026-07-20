"""Central gate for IB historical-data pacing.

Every historical wire request in the process must pass through one PacingGate.
IB's (undocumented but enforced) limits, with our safety margins:

- ~60 requests per rolling 10 minutes -> default budget 55/600s
- an identical request (same contract/end/duration/bar size/what-to-show)
  within 15 seconds is rejected
- no more than ~6 requests per contract+tick-type per 2 seconds
- BID_ASK historical requests count double

The gate is a model of IB's counters, not the truth: when IB still reports a
pacing violation (error 162), report_violation() drains the gate for a full
cooldown before anything else is sent.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

IdenticalKey = tuple[Any, ...]
ContractKey = tuple[Any, ...]


class PacingGate:
    def __init__(
        self,
        *,
        max_requests: int = 55,
        window_s: float = 600.0,
        identical_cooldown_s: float = 15.0,
        contract_burst: int = 5,
        contract_burst_window_s: float = 2.0,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._max_requests = max_requests
        self._window_s = window_s
        self._identical_cooldown_s = identical_cooldown_s
        self._contract_burst = contract_burst
        self._contract_burst_window_s = contract_burst_window_s
        self._now = now
        self._sleep = sleep

        self._events: deque[tuple[float, int]] = deque()
        self._window_cost = 0
        self._identical: dict[IdenticalKey, float] = {}
        self._per_contract: dict[ContractKey, deque[float]] = {}
        self._blocked_until = -float("inf")
        self._lock = asyncio.Lock()

    def report_violation(self, cooldown_s: float = 60.0) -> None:
        """IB reported a real pacing violation: block all sends for cooldown_s."""
        self._blocked_until = max(self._blocked_until, self._now() + cooldown_s)

    def snapshot(self) -> dict[str, Any]:
        now = self._now()
        self._evict(now)
        return {
            "window_cost": self._window_cost,
            "window_budget": self._max_requests,
            "blocked_for_s": max(0.0, self._blocked_until - now),
        }

    async def acquire(
        self,
        *,
        cost: int = 1,
        identical_key: IdenticalKey | None = None,
        contract_key: ContractKey | None = None,
    ) -> None:
        while True:
            async with self._lock:
                now = self._now()
                wait = self._next_allowed_in(now, cost, identical_key, contract_key)
                if wait <= 0:
                    self._record(now, cost, identical_key, contract_key)
                    return
            await self._sleep(wait)

    def _next_allowed_in(
        self,
        now: float,
        cost: int,
        identical_key: IdenticalKey | None,
        contract_key: ContractKey | None,
    ) -> float:
        wait = self._blocked_until - now
        self._evict(now)

        if self._window_cost + cost > self._max_requests and self._events:
            oldest_ts = self._events[0][0]
            wait = max(wait, oldest_ts + self._window_s - now)

        if identical_key is not None:
            last = self._identical.get(identical_key)
            if last is not None:
                wait = max(wait, last + self._identical_cooldown_s - now)

        if contract_key is not None:
            recent = self._per_contract.get(contract_key)
            if recent is not None and len(recent) >= self._contract_burst:
                wait = max(wait, recent[0] + self._contract_burst_window_s - now)

        return wait

    def _record(
        self,
        now: float,
        cost: int,
        identical_key: IdenticalKey | None,
        contract_key: ContractKey | None,
    ) -> None:
        self._events.append((now, cost))
        self._window_cost += cost
        if identical_key is not None:
            self._identical[identical_key] = now
        if contract_key is not None:
            self._per_contract.setdefault(contract_key, deque()).append(now)

    def _evict(self, now: float) -> None:
        while self._events and self._events[0][0] + self._window_s <= now:
            _, cost = self._events.popleft()
            self._window_cost -= cost
        for key in list(self._per_contract):
            recent = self._per_contract[key]
            while recent and recent[0] + self._contract_burst_window_s <= now:
                recent.popleft()
            if not recent:
                del self._per_contract[key]
        if self._identical:
            expired = [
                key
                for key, ts in self._identical.items()
                if ts + self._identical_cooldown_s <= now
            ]
            for key in expired:
                del self._identical[key]
