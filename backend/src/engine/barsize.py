"""IB bar sizes: aliases, per-chunk request windows, and Nautilus bar-type mapping.

A BARS chunk is exactly one reqHistoricalData call. ``window`` is the chunk
length the planner uses and is chosen as the MINIMUM span the IB ``duration``
string can cover (calendar months/years vary in length): the request therefore
always covers at least the chunk, and the converter filters returned bars to
the chunk range, so variable-length durations can never create gaps.
"""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class BarSpec:
    ib_size: str  # IB barSizeSetting, e.g. "15 mins"
    duration: str  # IB durationStr for one chunk, e.g. "1 W"
    window: timedelta  # chunk length (minimum span of `duration`)
    step: int  # aggregation step, e.g. 15
    aggregation: str  # Nautilus aggregation: SECOND|MINUTE|HOUR|DAY|WEEK|MONTH
    interval: timedelta  # length of one bar (approximate for MONTH)


_DAY = timedelta(days=1)

_TABLE: list[BarSpec] = [
    BarSpec("1 secs", "1800 S", timedelta(seconds=1800), 1, "SECOND", timedelta(seconds=1)),
    BarSpec("5 secs", "3600 S", timedelta(seconds=3600), 5, "SECOND", timedelta(seconds=5)),
    BarSpec("10 secs", "14400 S", timedelta(seconds=14400), 10, "SECOND", timedelta(seconds=10)),
    BarSpec("15 secs", "14400 S", timedelta(seconds=14400), 15, "SECOND", timedelta(seconds=15)),
    BarSpec("30 secs", "28800 S", timedelta(seconds=28800), 30, "SECOND", timedelta(seconds=30)),
    BarSpec("1 min", "1 D", _DAY, 1, "MINUTE", timedelta(minutes=1)),
    BarSpec("2 mins", "2 D", 2 * _DAY, 2, "MINUTE", timedelta(minutes=2)),
    BarSpec("3 mins", "1 W", 7 * _DAY, 3, "MINUTE", timedelta(minutes=3)),
    BarSpec("5 mins", "1 W", 7 * _DAY, 5, "MINUTE", timedelta(minutes=5)),
    BarSpec("10 mins", "1 W", 7 * _DAY, 10, "MINUTE", timedelta(minutes=10)),
    BarSpec("15 mins", "1 W", 7 * _DAY, 15, "MINUTE", timedelta(minutes=15)),
    BarSpec("20 mins", "1 W", 7 * _DAY, 20, "MINUTE", timedelta(minutes=20)),
    BarSpec("30 mins", "1 M", 28 * _DAY, 30, "MINUTE", timedelta(minutes=30)),
    BarSpec("1 hour", "1 M", 28 * _DAY, 1, "HOUR", timedelta(hours=1)),
    BarSpec("2 hours", "2 M", 56 * _DAY, 2, "HOUR", timedelta(hours=2)),
    BarSpec("3 hours", "3 M", 84 * _DAY, 3, "HOUR", timedelta(hours=3)),
    BarSpec("4 hours", "3 M", 84 * _DAY, 4, "HOUR", timedelta(hours=4)),
    BarSpec("8 hours", "6 M", 168 * _DAY, 8, "HOUR", timedelta(hours=8)),
    BarSpec("1 day", "1 Y", 365 * _DAY, 1, "DAY", _DAY),
    BarSpec("1 week", "2 Y", 730 * _DAY, 1, "WEEK", 7 * _DAY),
    BarSpec("1 month", "5 Y", 1825 * _DAY, 1, "MONTH", timedelta(days=31)),
]

BAR_SIZES: dict[str, BarSpec] = {spec.ib_size: spec for spec in _TABLE}

# MetaTrader-style aliases accepted by the API alongside raw IB bar sizes.
ALIASES: dict[str, str] = {
    "M1": "1 min",
    "M2": "2 mins",
    "M3": "3 mins",
    "M5": "5 mins",
    "M10": "10 mins",
    "M15": "15 mins",
    "M20": "20 mins",
    "M30": "30 mins",
    "H1": "1 hour",
    "H2": "2 hours",
    "H3": "3 hours",
    "H4": "4 hours",
    "H8": "8 hours",
    "D1": "1 day",
    "W1": "1 week",
    "MN1": "1 month",
    "S1": "1 secs",
    "S5": "5 secs",
    "S10": "10 secs",
    "S15": "15 secs",
    "S30": "30 secs",
}

# IB whatToShow -> Nautilus bar-type price type
PRICE_TYPES: dict[str, str] = {
    "TRADES": "LAST",
    "MIDPOINT": "MID",
    "BID": "BID",
    "ASK": "ASK",
}

# Bars of 30 seconds and finer are only available for roughly the last 6 months.
SECONDS_AVAILABILITY = timedelta(days=180)


def normalize_bar_size(value: str) -> BarSpec:
    key = value.strip()
    ib_size = ALIASES.get(key.upper(), key)
    spec = BAR_SIZES.get(ib_size)
    if spec is None:
        allowed = ", ".join(list(ALIASES) + list(BAR_SIZES))
        raise ValueError(f"Unsupported bar size {value!r}; allowed: {allowed}")
    return spec


def bar_type_name(instrument_id: str, spec: BarSpec, what_to_show: str) -> str:
    price_type = PRICE_TYPES[what_to_show]
    return f"{instrument_id}-{spec.step}-{spec.aggregation}-{price_type}-EXTERNAL"
