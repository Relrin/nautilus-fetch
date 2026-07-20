"""Deterministic in-memory stand-ins for the narrow IB surface the app consumes.

Grows with each milestone: M1 needs symbol search + contract details; the bars
and ticks pipelines (M2/M3) add historical data methods and fault injection.
"""

import asyncio
import math
from collections import Counter
from datetime import UTC, datetime

from ib_async import BarData, Contract, ContractDescription, ContractDetails, TagValue
from ib_async.objects import (
    HistoricalTickBidAsk,
    HistoricalTickLast,
    TickAttribBidAsk,
    TickAttribLast,
)

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
        self.faults: dict[int, list[Exception]] = {}  # per-conId FIFO of scripted failures
        self.head_ts: dict[int, datetime] = {}
        self.latency_s: float = 0.0  # artificial per-request latency
        self.historical_calls: list[dict] = []
        self.tick_calls: list[dict] = []
        # deterministic tick stream: one tick every N seconds...
        self.tick_every_s: int = 2
        # ...except dense seconds: (conId, epoch_second) -> tick count that second
        self.dense_seconds: dict[tuple[int, int], int] = {}
        self.RaiseRequestErrors = False  # set by the real connection manager; unused here
        self.depth_tickers: dict[int, FakeTicker] = {}
        self.active_depth: set[int] = set()

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
        self.faults.setdefault(con_id, []).append(exc)

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
        faults = self.faults.get(contract.conId)
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


    def _tick_seconds(self, con_id: int, from_s: int, horizon_s: int):
        """Yield (epoch_second, tick_count): sparse grid merged with dense overrides."""
        dense = sorted(
            s for (cid, s) in self.dense_seconds if cid == con_id and from_s <= s < horizon_s
        )
        dense_index = 0
        step = self.tick_every_s
        grid = from_s + ((-from_s) % step)
        while grid < horizon_s or dense_index < len(dense):
            next_dense = dense[dense_index] if dense_index < len(dense) else None
            if next_dense is not None and (grid >= horizon_s or next_dense <= grid):
                yield next_dense, self.dense_seconds[(con_id, next_dense)]
                if next_dense == grid:
                    grid += step
                dense_index += 1
            else:
                if grid >= horizon_s:
                    break
                yield grid, 1
                grid += step

    async def reqHistoricalTicksAsync(
        self,
        contract: Contract,
        startDateTime,
        endDateTime,
        numberOfTicks: int,
        whatToShow: str,
        useRth: bool,
        ignoreSize: bool = False,
        miscOptions: list | None = None,
    ) -> list:
        self.calls["reqHistoricalTicks"] += 1
        self.tick_calls.append(
            {"con_id": contract.conId, "start": startDateTime, "what": whatToShow, "n": numberOfTicks}
        )
        if self.latency_s:
            await asyncio.sleep(self.latency_s)
        faults = self.faults.get(contract.conId)
        if faults:
            raise faults.pop(0)

        from_s = int(math.ceil(startDateTime.timestamp()))
        horizon_s = from_s + 60 * 86_400
        base = 100.0 + (contract.conId % 50)
        out: list = []
        for sec, count in self._tick_seconds(contract.conId, from_s, horizon_s):
            mid = base + 2.0 * math.sin(sec / 600.0)
            moment = datetime.fromtimestamp(sec, tz=UTC)
            for index in range(count):
                if whatToShow == "BID_ASK":
                    out.append(
                        HistoricalTickBidAsk(
                            moment,
                            TickAttribBidAsk(),
                            round(mid - 0.01, 2),
                            round(mid + 0.01, 2),
                            100.0,
                            200.0,
                        )
                    )
                else:
                    out.append(
                        HistoricalTickLast(
                            moment, TickAttribLast(), round(mid, 2), 10.0 + index, "", ""
                        )
                    )
                if len(out) >= numberOfTicks:
                    return out
        return out


    def reqMktDepth(self, contract: Contract, numRows: int = 5, isSmartDepth: bool = False, mktDepthOptions=None):
        self.calls["reqMktDepth"] += 1
        self.active_depth.add(contract.conId)
        ticker = self.depth_tickers.get(contract.conId)
        if ticker is None:
            base = 100.0 + (contract.conId % 50)
            ticker = FakeTicker(contract)
            ticker.set_levels(
                bids=[(round(base - 0.01 * (i + 1), 2), 100.0 * (i + 1)) for i in range(numRows)],
                asks=[(round(base + 0.01 * (i + 1), 2), 90.0 * (i + 1)) for i in range(numRows)],
            )
            self.depth_tickers[contract.conId] = ticker
        return ticker

    def cancelMktDepth(self, contract: Contract, isSmartDepth: bool = False) -> None:
        self.calls["cancelMktDepth"] += 1
        self.active_depth.discard(contract.conId)


class FakeTicker:
    """Just enough of ib_async.Ticker for the depth recorder: domBids/domAsks + updateEvent."""

    def __init__(self, contract: Contract) -> None:
        import eventkit

        self.contract = contract
        self.domBids: list = []
        self.domAsks: list = []
        self.updateEvent = eventkit.Event()

    def set_levels(self, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> None:
        from ib_async.objects import DOMLevel

        self.domBids = [DOMLevel(price, size, "") for price, size in bids]
        self.domAsks = [DOMLevel(price, size, "") for price, size in asks]
        self.updateEvent.emit(self)


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
