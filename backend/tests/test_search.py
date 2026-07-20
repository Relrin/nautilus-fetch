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
)
from tests.fake_ib import FakeConn, FakeIB, aapl_details, eurusd_details


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
    ib.add_details(eurusd_details())
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


async def test_min_interval_limiter_spaces_calls():
    limiter = MinIntervalLimiter(0.05)
    start = time.monotonic()
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    assert time.monotonic() - start >= 0.10
