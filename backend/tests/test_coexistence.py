"""ib_async and nautilus_trader[ib] must coexist, and the contract shim must work."""


def test_ib_async_and_nautilus_ibapi_coexist():
    import ib_async
    import ibapi  # installed by nautilus_trader[ib] as nautilus-ibapi

    assert ib_async.__version__ == "2.1.0"
    assert ibapi is not None


def test_shim_parses_equity_contract_details():
    from ib_async import Contract, ContractDetails, TagValue

    from nautilus_fetch.ib.shim import details_to_instrument

    contract = Contract(
        secType="STK",
        conId=265598,
        symbol="AAPL",
        exchange="SMART",
        primaryExchange="NASDAQ",
        currency="USD",
        localSymbol="AAPL",
        tradingClass="NMS",
    )
    details = ContractDetails(
        contract=contract,
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
        # equity parsing requires an ISIN; real gateway responses include it
        secIdList=[TagValue("ISIN", "US0378331005")],
    )

    instrument = details_to_instrument(details)

    assert str(instrument.id) == "AAPL.NASDAQ"
    assert instrument.price_increment.as_double() == 0.01


def test_shim_derives_forex_venue():
    from ib_async import Contract, ContractDetails

    from nautilus_fetch.ib.shim import details_to_instrument

    contract = Contract(
        secType="CASH",
        conId=12087792,
        symbol="EUR",
        exchange="IDEALPRO",
        currency="USD",
        localSymbol="EUR.USD",
        tradingClass="EUR.USD",
    )
    details = ContractDetails(
        contract=contract,
        marketName="EUR.USD",
        minTick=5e-05,
        priceMagnifier=1,
        longName="European Monetary Union Euro",
        minSize=1.0,
        sizeIncrement=1.0,
        timeZoneId="UTC",
        validExchanges="IDEALPRO",
    )

    instrument = details_to_instrument(details)

    assert str(instrument.id) == "EUR/USD.IDEALPRO"
