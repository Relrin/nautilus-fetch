from datetime import UTC, datetime, timedelta

import pytest

from nautilus_fetch.engine.barsize import normalize_bar_size
from nautilus_fetch.engine.planner import InstrumentPlanInput, PlanningError, plan_bars

NOW = datetime(2026, 7, 20, tzinfo=UTC)
AAPL = InstrumentPlanInput(con_id=265598, instrument_id="AAPL.NASDAQ", sec_type="STK")
EURUSD = InstrumentPlanInput(con_id=12087792, instrument_id="EUR/USD.IDEALPRO", sec_type="CASH")


def test_alias_normalization():
    assert normalize_bar_size("M15").ib_size == "15 mins"
    assert normalize_bar_size("H4").ib_size == "4 hours"
    assert normalize_bar_size("W1").ib_size == "1 week"
    assert normalize_bar_size("MN1").ib_size == "1 month"
    assert normalize_bar_size("15 mins").ib_size == "15 mins"
    with pytest.raises(ValueError, match="Unsupported bar size"):
        normalize_bar_size("7 mins")


def test_minute_bars_skip_weekends_for_stocks():
    spec = normalize_bar_size("M1")
    # Mon 2026-06-01 .. Mon 2026-06-08: 7 daily chunks, minus Sat/Sun
    chunks, _ = plan_bars(
        [AAPL],
        spec,
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 8, tzinfo=UTC),
        now=NOW,
        max_chunks=1000,
    )
    assert len(chunks) == 5
    assert all(
        datetime.fromtimestamp(c.range_start_ns / 1e9, tz=UTC).weekday() < 5 for c in chunks
    )


def test_weekend_chunk_covering_monday_is_kept():
    spec = normalize_bar_size("M1")
    # range anchored Sunday evening: the Sun 18:00 -> Mon 18:00 chunk covers
    # Monday trading and must NOT be skipped
    chunks, _ = plan_bars(
        [AAPL],
        spec,
        datetime(2026, 6, 6, 18, 0, tzinfo=UTC),  # Sat evening
        datetime(2026, 6, 8, 18, 0, tzinfo=UTC),  # Mon evening
        now=NOW,
        max_chunks=100,
    )
    # Sat 18:00 -> Sun 18:00 skipped (all weekend); Sun 18:00 -> Mon 18:00 kept
    assert len(chunks) == 1
    start = datetime.fromtimestamp(chunks[0].range_start_ns / 1e9, tz=UTC)
    assert start == datetime(2026, 6, 7, 18, 0, tzinfo=UTC)


def test_fx_keeps_weekend_chunks():
    spec = normalize_bar_size("M1")
    chunks, _ = plan_bars(
        [EURUSD],
        spec,
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 8, tzinfo=UTC),
        now=NOW,
        max_chunks=1000,
    )
    assert len(chunks) == 7


def test_multi_symbol_seq_is_contiguous():
    spec = normalize_bar_size("M1")
    chunks, _ = plan_bars(
        [AAPL, EURUSD],
        spec,
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 3, tzinfo=UTC),
        now=NOW,
        max_chunks=1000,
    )
    assert [c.seq for c in chunks] == list(range(len(chunks)))
    assert len(chunks) == 4  # 2 weekdays x 2 symbols


def test_seconds_bars_entirely_outside_availability_raises():
    spec = normalize_bar_size("5 secs")
    with pytest.raises(PlanningError, match="no chunks"):
        plan_bars(
            [AAPL],
            spec,
            datetime(2020, 1, 1, tzinfo=UTC),
            datetime(2020, 1, 10, tzinfo=UTC),
            now=NOW,
            max_chunks=100,
        )


def test_seconds_bars_partially_clamped_warns():
    spec = normalize_bar_size("30 secs")
    start = NOW - timedelta(days=400)
    end = NOW - timedelta(days=170)
    chunks, warnings = plan_bars([EURUSD], spec, start, end, now=NOW, max_chunks=10_000)
    assert chunks
    assert any("clamped" in w for w in warnings)
    first_start = datetime.fromtimestamp(chunks[0].range_start_ns / 1e9, tz=UTC)
    assert first_start >= NOW - timedelta(days=181)


def test_head_timestamp_clamps_range():
    spec = normalize_bar_size("D1")
    listed = datetime(2024, 6, 1, tzinfo=UTC)
    instrument = InstrumentPlanInput(
        con_id=1, instrument_id="NEW.NASDAQ", sec_type="STK", head_timestamp=listed
    )
    chunks, warnings = plan_bars(
        [instrument],
        spec,
        datetime(2020, 1, 1, tzinfo=UTC),
        datetime(2025, 1, 1, tzinfo=UTC),
        now=NOW,
        max_chunks=100,
    )
    assert any("IB data starts" in w for w in warnings)
    first_start = datetime.fromtimestamp(chunks[0].range_start_ns / 1e9, tz=UTC)
    assert first_start == listed


def test_chunk_cap_enforced():
    spec = normalize_bar_size("M1")
    with pytest.raises(PlanningError, match="more than 10 chunks"):
        plan_bars(
            [EURUSD],
            spec,
            datetime(2026, 1, 1, tzinfo=UTC),
            datetime(2026, 3, 1, tzinfo=UTC),
            now=NOW,
            max_chunks=10,
        )


def test_weekly_and_monthly_windows():
    week_chunks, _ = plan_bars(
        [AAPL],
        normalize_bar_size("W1"),
        datetime(2020, 1, 1, tzinfo=UTC),
        datetime(2026, 1, 1, tzinfo=UTC),
        now=NOW,
        max_chunks=100,
    )
    assert len(week_chunks) == 4  # ~6 years / 730-day windows

    month_chunks, _ = plan_bars(
        [AAPL],
        normalize_bar_size("MN1"),
        datetime(2020, 1, 1, tzinfo=UTC),
        datetime(2026, 1, 1, tzinfo=UTC),
        now=NOW,
        max_chunks=100,
    )
    assert len(month_chunks) == 2  # ~6 years / 5-year windows
