import time

import pytest

from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.ib.connection import ConnState
from nautilus_fetch.ib.search import (
    IBUnavailableError,
    InstrumentNotFoundError,
    InstrumentSearchService,
    MinIntervalLimiter,
    parse_forex_query,
)
from tests.fake_ib import (
    FakeConn,
    FakeIB,
    aapl_details,
    eurgbp_details,
    eurusd_details,
    gbpusd_details,
)


@pytest.fixture
async def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/search.sqlite"
    await run_migrations(url)
    engine = create_db_engine(url)
    yield engine
    await engine.dispose()


@pytest.fixture
def fake_ib() -> FakeIB:
    ib = FakeIB()
    ib.add_details(aapl_details())
    # forex pairs are NOT returned by reqMatchingSymbols: register them as IB
    # actually behaves, resolvable only through contract details
    ib.add_details(eurusd_details(), matchable=False)
    ib.add_details(gbpusd_details(), matchable=False)
    ib.add_details(eurgbp_details(), matchable=False)
    return ib


def make_service(fake_ib: FakeIB, db, **kwargs) -> InstrumentSearchService:
    kwargs.setdefault("search_min_interval_s", 0.0)
    return InstrumentSearchService(FakeConn(fake_ib), db, **kwargs)


async def test_search_maps_results(fake_ib, db):
    service = make_service(fake_ib, db)
    results = await service.search("AAPL")
    assert len(results) == 1
    assert results[0]["con_id"] == 265598
    assert results[0]["sec_type"] == "STK"
    assert results[0]["primary_exchange"] == "NASDAQ"


async def test_search_filters_sec_type(fake_ib, db):
    service = make_service(fake_ib, db)
    assert await service.search("AAPL", sec_type="STK")
    assert await service.search("AAPL", sec_type="FUT") == []


async def test_search_requires_connection(fake_ib, db):
    service = InstrumentSearchService(FakeConn(fake_ib, state=ConnState.DISCONNECTED), db)
    with pytest.raises(IBUnavailableError):
        await service.search("AAPL")


async def test_details_parses_and_caches(fake_ib, db):
    service = make_service(fake_ib, db)
    row = await service.details(265598)
    assert row["instrument_id"] == "AAPL.NASDAQ"
    assert row["description"] == "APPLE INC"

    again = await service.details(265598)
    assert again["instrument_id"] == "AAPL.NASDAQ"
    assert fake_ib.calls["reqContractDetails"] == 1  # second call served from DB cache

    refreshed = await service.details(265598, refresh=True)
    assert refreshed["instrument_id"] == "AAPL.NASDAQ"
    assert fake_ib.calls["reqContractDetails"] == 2


async def test_details_cache_expires(fake_ib, db):
    service = make_service(fake_ib, db, cache_ttl_s=0.0)
    await service.details(265598)
    await service.details(265598)
    assert fake_ib.calls["reqContractDetails"] == 2


async def test_details_without_isin_still_derives_id(fake_ib, db):
    details = aapl_details()
    details.secIdList = []
    fake_ib.details[265598] = [details]
    service = make_service(fake_ib, db)
    row = await service.details(265598)
    assert row["instrument_id"] == "AAPL.NASDAQ"  # id-only fallback path


async def test_details_unknown_conid_raises(fake_ib, db):
    service = make_service(fake_ib, db)
    with pytest.raises(InstrumentNotFoundError):
        await service.details(999)


async def test_forex_details_instrument_id(fake_ib, db):
    service = make_service(fake_ib, db)
    row = await service.details(12087792)
    assert row["instrument_id"] == "EUR/USD.IDEALPRO"


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("EUR.USD", ("EUR", "USD")),
        ("eur/usd", ("EUR", "USD")),
        ("EUR-USD", ("EUR", "USD")),
        ("EURUSD", ("EUR", "USD")),
        ("EUR USD", ("EUR", "USD")),
        ("EUR", ("EUR", None)),
        ("AAPL", None),  # not a currency
        ("GOOGL", None),  # 5 letters
        ("ABCDEF", None),  # 6 letters, not currencies
        ("XYZ.USD", None),  # base not a currency
        ("", None),
    ],
)
def test_parse_forex_query(query, expected):
    assert parse_forex_query(query) == expected


async def test_search_explicit_forex_pair_skips_stock_search(fake_ib, db):
    service = make_service(fake_ib, db)
    results = await service.search("EUR.USD")
    assert [row["con_id"] for row in results] == [12087792]
    assert results[0]["sec_type"] == "CASH"
    assert results[0]["currency"] == "USD"
    # an explicit pair is unambiguously forex: no wasted symbol search
    assert fake_ib.calls["reqMatchingSymbols"] == 0


async def test_search_concatenated_forex_pair(fake_ib, db):
    service = make_service(fake_ib, db)
    results = await service.search("gbpusd")
    assert [row["con_id"] for row in results] == [12087797]


async def test_search_bare_currency_returns_all_pairs_and_runs_stock_search(fake_ib, db):
    service = make_service(fake_ib, db)
    results = await service.search("EUR")
    con_ids = {row["con_id"] for row in results}
    assert con_ids == {12087792, 12087801}  # EUR.USD and EUR.GBP
    # a bare currency is ambiguous, so the stock search still runs
    assert fake_ib.calls["reqMatchingSymbols"] == 1


async def test_search_cash_sec_type_only_forex(fake_ib, db):
    service = make_service(fake_ib, db)
    results = await service.search("EUR", sec_type="CASH")
    assert {row["con_id"] for row in results} == {12087792, 12087801}
    assert fake_ib.calls["reqMatchingSymbols"] == 0


async def test_search_non_currency_does_not_hit_forex_path(fake_ib, db):
    service = make_service(fake_ib, db)
    await service.search("AAPL")
    assert fake_ib.calls["reqContractDetails"] == 0  # no forex CASH lookup
    assert fake_ib.calls["reqMatchingSymbols"] == 1


async def test_min_interval_limiter_spaces_calls():
    limiter = MinIntervalLimiter(0.05)
    start = time.monotonic()
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    assert time.monotonic() - start >= 0.10
