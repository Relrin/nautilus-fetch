import asyncio

from nautilus_fetch.pacing import PacingGate


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds
        await asyncio.sleep(0)  # yield control


def make_gate(clock: FakeClock, **kwargs) -> PacingGate:
    kwargs.setdefault("max_requests", 3)
    kwargs.setdefault("window_s", 10.0)
    kwargs.setdefault("identical_cooldown_s", 15.0)
    kwargs.setdefault("contract_burst", 2)
    kwargs.setdefault("contract_burst_window_s", 2.0)
    return PacingGate(now=clock.now, sleep=clock.sleep, **kwargs)


async def test_window_budget_blocks_and_frees():
    clock = FakeClock()
    gate = make_gate(clock)
    for _ in range(3):
        await gate.acquire()
    assert clock.t == 0.0
    await gate.acquire()  # must wait for the first event to leave the 10s window
    assert clock.t == 10.0


async def test_costs_count_double():
    clock = FakeClock()
    gate = make_gate(clock)
    await gate.acquire(cost=2)
    await gate.acquire(cost=1)
    assert clock.t == 0.0
    await gate.acquire(cost=1)  # 2+1+1 > 3 -> wait
    assert clock.t == 10.0


async def test_identical_request_cooldown():
    clock = FakeClock()
    gate = make_gate(clock, max_requests=100)
    key = ("bars", 1, 42)
    await gate.acquire(identical_key=key)
    await gate.acquire(identical_key=("other",))
    assert clock.t == 0.0
    await gate.acquire(identical_key=key)
    assert clock.t == 15.0


async def test_contract_burst_limit():
    clock = FakeClock()
    gate = make_gate(clock, max_requests=100)
    contract = (265598, "SMART", "TRADES")
    await gate.acquire(contract_key=contract)
    await gate.acquire(contract_key=contract)
    assert clock.t == 0.0
    await gate.acquire(contract_key=contract)  # burst of 2 per 2s exceeded
    assert clock.t == 2.0


async def test_violation_feedback_blocks_everything():
    clock = FakeClock()
    gate = make_gate(clock, max_requests=100)
    await gate.acquire()
    gate.report_violation(60.0)
    await gate.acquire()
    assert clock.t == 60.0
    assert gate.snapshot()["blocked_for_s"] == 0.0
