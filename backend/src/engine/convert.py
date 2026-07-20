"""Convert IB historical results into Nautilus objects.

Nautilus objects are constructed directly (via instrument.make_price/make_qty
for correct precisions) rather than through the pandas-based wranglers: the
wranglers' Cython internals require writable numpy buffers, which pandas 3.x
copy-on-write no longer provides.
"""

import calendar
import json
from datetime import UTC, date, datetime
from typing import Any

from nautilus_trader.model.data import Bar, BarType, QuoteTick, TradeTick
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.identifiers import TradeId
from nautilus_trader.model.instruments import Instrument

from nautilus_fetch.engine.barsize import BarSpec
from nautilus_fetch.ib.serialize import contract_from_jsonable, details_from_jsonable
from nautilus_fetch.ib.shim import details_to_instrument

_NS = 1_000_000_000


class InstrumentConversionError(ValueError):
    pass


def instrument_from_row(row: dict[str, Any]) -> Instrument:
    """Rebuild the Nautilus instrument from a cached instruments-table row."""
    if not row.get("details_json"):
        raise InstrumentConversionError(f"conId={row.get('con_id')} has no cached contract details")
    details = details_from_jsonable(json.loads(row["details_json"]))
    try:
        return details_to_instrument(details)
    except Exception as exc:
        raise InstrumentConversionError(
            f"{row.get('instrument_id') or row.get('con_id')}: cannot build a Nautilus "
            f"instrument definition ({exc}); this contract is not usable for download jobs"
        ) from exc


def contract_from_row(row: dict[str, Any]):
    details = json.loads(row["details_json"])
    return contract_from_jsonable(details.get("contract") or {})


def _bar_open_utc(raw: datetime | date) -> datetime:
    if isinstance(raw, datetime):
        return raw.astimezone(UTC) if raw.tzinfo is not None else raw.replace(tzinfo=UTC)
    return datetime(raw.year, raw.month, raw.day, tzinfo=UTC)  # daily+ bars arrive as dates


def _add_months(moment: datetime, months: int) -> datetime:
    month0 = moment.month - 1 + months
    year = moment.year + month0 // 12
    month = month0 % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def bars_to_nautilus(
    ib_bars: list[Any],
    *,
    instrument: Instrument,
    bar_type: BarType,
    spec: BarSpec,
    range_start_ns: int,
    range_end_ns: int,
) -> list[Bar]:
    """IB BarData list -> Nautilus Bars with close-time timestamps, filtered to the chunk.

    IB timestamps bars at their OPEN; Nautilus convention is the bar CLOSE, so
    every timestamp is shifted forward one bar interval before filtering. In
    close-time terms a chunk covers the half-open range (start, end]: the bar
    closing exactly at the chunk boundary belongs to the earlier chunk (its
    open lies inside that chunk's request window and no other request would
    ever return it). The request duration may cover more than the chunk
    (calendar-length durations), so filtering here is what guarantees
    chunk-disjoint, gap-free output.
    """
    out: list[Bar] = []
    for ib_bar in ib_bars:
        open_dt = _bar_open_utc(ib_bar.date)
        if spec.aggregation == "MONTH":
            close_dt = _add_months(open_dt, spec.step)
        else:
            close_dt = open_dt + spec.interval
        ts = int(close_dt.timestamp() * _NS)
        if not range_start_ns < ts <= range_end_ns:
            continue
        out.append(
            Bar(
                bar_type=bar_type,
                open=instrument.make_price(float(ib_bar.open)),
                high=instrument.make_price(float(ib_bar.high)),
                low=instrument.make_price(float(ib_bar.low)),
                close=instrument.make_price(float(ib_bar.close)),
                # IB reports volume -1 where volume is not applicable (e.g. MIDPOINT)
                volume=instrument.make_qty(max(float(ib_bar.volume), 0.0)),
                ts_event=ts,
                ts_init=ts,
            )
        )
    out.sort(key=lambda bar: bar.ts_event)
    return out


def trade_ticks_to_nautilus(
    raw_ticks: list[Any],
    *,
    instrument: Instrument,
    range_start_ns: int,
    range_end_ns: int,
) -> list[TradeTick]:
    """IB HistoricalTickLast list -> Nautilus TradeTicks, filtered to [start, end).

    IB tick times have second resolution and no trade ids; ids are synthesized
    as "<epoch_second>-<index-within-second>", which is unique per instrument
    because chunk boundaries fall on whole seconds.
    """
    out: list[TradeTick] = []
    per_second: dict[int, int] = {}
    for tick in raw_ticks:
        ts_s = int(tick.time.timestamp())
        ts = ts_s * _NS
        if not range_start_ns <= ts < range_end_ns:
            continue
        price = float(tick.price)
        size = float(tick.size)
        if price <= 0 or size <= 0:  # unreported/combo artifacts
            continue
        index = per_second.get(ts_s, 0)
        per_second[ts_s] = index + 1
        out.append(
            TradeTick(
                instrument_id=instrument.id,
                price=instrument.make_price(price),
                size=instrument.make_qty(size),
                aggressor_side=AggressorSide.NO_AGGRESSOR,
                trade_id=TradeId(f"{ts_s}-{index}"),
                ts_event=ts,
                ts_init=ts,
            )
        )
    out.sort(key=lambda tick: tick.ts_event)
    return out


def quote_ticks_to_nautilus(
    raw_ticks: list[Any],
    *,
    instrument: Instrument,
    range_start_ns: int,
    range_end_ns: int,
) -> list[QuoteTick]:
    """IB HistoricalTickBidAsk list -> Nautilus QuoteTicks, filtered to [start, end)."""
    out: list[QuoteTick] = []
    for tick in raw_ticks:
        ts = int(tick.time.timestamp()) * _NS
        if not range_start_ns <= ts < range_end_ns:
            continue
        bid = float(tick.priceBid)
        ask = float(tick.priceAsk)
        if bid <= 0 or ask <= 0:
            continue
        out.append(
            QuoteTick(
                instrument_id=instrument.id,
                bid_price=instrument.make_price(bid),
                ask_price=instrument.make_price(ask),
                bid_size=instrument.make_qty(max(float(tick.sizeBid), 0.0)),
                ask_size=instrument.make_qty(max(float(tick.sizeAsk), 0.0)),
                ts_event=ts,
                ts_init=ts,
            )
        )
    out.sort(key=lambda tick: tick.ts_event)
    return out


def chunk_end_datetime(range_end_ns: int) -> datetime:
    return datetime.fromtimestamp(range_end_ns / _NS, tz=UTC)


def chunk_start_datetime(range_start_ns: int) -> datetime:
    return datetime.fromtimestamp(range_start_ns / _NS, tz=UTC)
