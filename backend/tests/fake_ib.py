"""Deterministic in-memory stand-ins for the narrow IB surface the app consumes.

Grows with each milestone: M1 needs symbol search + contract details; the bars
and ticks pipelines (M2/M3) add historical data methods and fault injection.
"""

import asyncio
import math
from collections import Counter
from datetime import UTC, datetime

from ib_async import BarData, Contract, ContractDescription, ContractDetails, TagValue

from nautilus_fetch.engine.barsize import BAR_SIZES
from nautilus_fetch.ib.connection import ConnState


def aapl_details() -> ContractDetails:
    return ContractDetails(
        contract=Contract(
            secType="STK",
            conId=265598,
            symbol="AAPL",
            exchange="SMART",
            primaryExchange="NASDAQ",
            currency="USD",
            localSymbol="AAPL",
            tradingClass="NMS",
        ),
        marketName="NMS",
        minTick=0.01,
        priceMagnifier=1,
        longName="APPLE INC",
        stockType="COMMON",
        minSize=1.0,
        sizeIncrement=1.0,
        suggestedSizeIncrement=100.0,
        timeZoneId="US/Eastern",
        validExchanges="SMART,NASDAQ",
        secIdList=[TagValue("ISIN", "US0378331005")],
    )


def eurusd_details() -> ContractDetails:
    return ContractDetails(
        contract=Contract(
            secType="CASH",
            conId=12087792,
            symbol="EUR",
            exchange="IDEALPRO",
            currency="USD",
            localSymbol="EUR.USD",
            tradingClass="EUR.USD",
        ),
        marketName="EUR.USD",
        minTick=5e-05,
        priceMagnifier=1,
        longName="European Monetary Union Euro",
        minSize=1.0,
        sizeIncrement=1.0,
        timeZoneId="UTC",
        validExchanges="IDEALPRO",
    )


def msft_details() -> ContractDetails:
    return ContractDetails(
        contract=Contract(
            secType="STK",
            conId=272093,
            symbol="MSFT",
            exchange="SMART",
            primaryExchange="NASDAQ",
            currency="USD",
            localSymbol="MSFT",
            tradingClass="NMS",
        ),
        marketName="NMS",
        minTick=0.01,
        priceMagnifier=1,
        longName="MICROSOFT CORP",
        stockType="COMMON",
        minSize=1.0,
        sizeIncrement=1.0,
        suggestedSizeIncrement=100.0,
        timeZoneId="US/Eastern",
        validExchanges="SMART,NASDAQ",
        secIdList=[TagValue("ISIN", "US5949181045")],
    )


class FakeIB:
    def __init__(self) -> None:
        self.calls: Counter[str] = Counter()
        self.matching: dict[str, list[ContractDescription]] = {}
        self.details: dict[int, list[ContractDetails]] = {}
        self.bar_faults: dict[int, list[Exception]] = {}  # per-conId FIFO of scripted failures
        self.head_ts: dict[int, datetime] = {}
        self.latency_s: float = 0.0  # artificial per-request latency
        self.historical_calls: list[dict] = []
        self.RaiseRequestErrors = False  # set by the real connection manager; unused here

    def add_details(self, details: ContractDetails) -> None:
        self.details[details.contract.conId] = [details]
        description = ContractDescription(contract=details.contract, derivativeSecTypes=[])
        self.matching.setdefault(details.contract.symbol, []).append(description)

    async def reqMatchingSymbolsAsync(self, pattern: str):
        self.calls["reqMatchingSymbols"] += 1
        return [
            description
            for symbol, descriptions in self.matching.items()
            if pattern.upper() in symbol.upper()
            for description in descriptions
        ]

    async def reqContractDetailsAsync(self, contract: Contract):
        self.calls["reqContractDetails"] += 1
        return list(self.details.get(contract.conId, []))

    def add_fault(self, con_id: int, exc: Exception) -> None:
        self.bar_faults.setdefault(con_id, []).append(exc)

    async def reqHeadTimeStampAsync(self, contract: Contract, whatToShow: str, useRTH: bool, formatDate: int):
        self.calls["reqHeadTimeStamp"] += 1
        return self.head_ts.get(contract.conId, datetime(2000, 1, 1, tzinfo=UTC))

    async def reqHistoricalDataAsync(
        self,
        contract: Contract,
        endDateTime: datetime,
        durationStr: str,
        barSizeSetting: str,
        whatToShow: str,
        useRTH: bool,
        formatDate: int = 1,
        keepUpToDate: bool = False,
        chartOptions: list | None = None,
        timeout: float = 60,
    ) -> list[BarData]:
        self.calls["reqHistoricalData"] += 1
        self.historical_calls.append(
            {"con_id": contract.conId, "end": endDateTime, "duration": durationStr, "bar_size": barSizeSetting}
        )
        if self.latency_s:
            await asyncio.sleep(self.latency_s)
        faults = self.bar_faults.get(contract.conId)
        if faults:
            raise faults.pop(0)

        spec = BAR_SIZES[barSizeSetting]
        start = endDateTime - spec.window
        bars: list[BarData] = []
        cursor = start
        base = 100.0 + (contract.conId % 50)
        while cursor < endDateTime:
            epoch = cursor.timestamp()
            mid = base + 2.0 * math.sin(epoch / 600.0)
            bars.append(
                BarData(
                    date=cursor,
                    open=round(mid - 0.02, 2),
                    high=round(mid + 0.05, 2),
                    low=round(mid - 0.05, 2),
                    close=round(mid + 0.02, 2),
                    volume=1000.0,
                    average=round(mid, 2),
                    barCount=10,
                )
            )
            cursor += spec.interval
        return bars


class FakeConn:
    """Mimics the IBConnectionManager surface that services use."""

    def __init__(self, ib: FakeIB, state: ConnState = ConnState.CONNECTED) -> None:
        self._ib = ib
        self.state = state

    @property
    def ib(self) -> FakeIB:
        return self._ib

    async def ready(self) -> None:
        return None
