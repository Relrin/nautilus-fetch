"""Deterministic in-memory stand-ins for the narrow IB surface the app consumes.

Grows with each milestone: M1 needs symbol search + contract details; the bars
and ticks pipelines (M2/M3) add historical data methods and fault injection.
"""

from collections import Counter

from ib_async import Contract, ContractDescription, ContractDetails, TagValue

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


class FakeIB:
    def __init__(self) -> None:
        self.calls: Counter[str] = Counter()
        self.matching: dict[str, list[ContractDescription]] = {}
        self.details: dict[int, list[ContractDetails]] = {}

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
