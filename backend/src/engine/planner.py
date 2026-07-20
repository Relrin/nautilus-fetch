"""Split a job's (instruments x date range) into chunks.

A BARS chunk maps to exactly one reqHistoricalData call, which makes pacing
accounting trivial. A tick chunk (instrument x hour for stocks, x day for
24h markets) internally cursors through as many 1000-tick requests as needed —
each of those wire requests is individually pacing-metered by the engine.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from nautilus_fetch.engine.barsize import SECONDS_AVAILABILITY, BarSpec

_NS = 1_000_000_000

# IB serves historical ticks only for roughly the last 6 months.
TICKS_AVAILABILITY = timedelta(days=180)


class PlanningError(ValueError):
    pass


@dataclass(frozen=True)
class PlannedChunk:
    seq: int
    con_id: int
    instrument_id: str
    range_start_ns: int
    range_end_ns: int


def _to_ns(moment: datetime) -> int:
    return int(moment.timestamp() * _NS)


def _skip_weekend(moment: datetime, sec_type: str, window: timedelta) -> bool:
    # Cheap heuristic for sub-day windows on equities: whole-weekend chunks are
    # guaranteed empty. FX/futures trade around the clock; anything else that
    # slips through simply completes as an empty chunk.
    return sec_type == "STK" and window <= timedelta(days=1) and moment.weekday() in (5, 6)


@dataclass(frozen=True)
class InstrumentPlanInput:
    con_id: int
    instrument_id: str
    sec_type: str
    head_timestamp: datetime | None = None  # earliest data IB has, when known


def _plan(
    instruments: list[InstrumentPlanInput],
    *,
    window_of: Callable[[InstrumentPlanInput], timedelta],
    availability: timedelta | None,
    availability_label: str,
    range_start: datetime,
    range_end: datetime,
    now: datetime,
    max_chunks: int,
) -> tuple[list[PlannedChunk], list[str]]:
    """Returns (chunks, warnings). Chunk ranges are half-open [start, end)."""
    if range_start.tzinfo is None or range_end.tzinfo is None:
        raise PlanningError("range_start and range_end must be timezone-aware")
    range_start = range_start.astimezone(UTC)
    range_end = range_end.astimezone(UTC)
    if range_end <= range_start:
        raise PlanningError("range_end must be after range_start")

    warnings: list[str] = []
    chunks: list[PlannedChunk] = []
    seq = 0

    for instrument in instruments:
        window = window_of(instrument)
        start = range_start
        if availability is not None:
            available_from = now.astimezone(UTC) - availability
            if start < available_from:
                warnings.append(
                    f"{instrument.instrument_id}: {availability_label} are only available "
                    f"for ~{availability.days} days; range clamped to {available_from.isoformat()}"
                )
                start = available_from
        head = instrument.head_timestamp
        if head is not None and head.astimezone(UTC) > start:
            warnings.append(
                f"{instrument.instrument_id}: IB data starts at {head.isoformat()}; "
                "earlier chunks skipped"
            )
            start = head.astimezone(UTC)
        if start >= range_end:
            warnings.append(f"{instrument.instrument_id}: nothing to fetch in range")
            continue

        cursor = start
        while cursor < range_end:
            window_end = min(cursor + window, range_end)
            if not _skip_weekend(cursor, instrument.sec_type, window):
                chunks.append(
                    PlannedChunk(
                        seq=seq,
                        con_id=instrument.con_id,
                        instrument_id=instrument.instrument_id,
                        range_start_ns=_to_ns(cursor),
                        range_end_ns=_to_ns(window_end),
                    )
                )
                seq += 1
                if seq > max_chunks:
                    raise PlanningError(
                        f"Job would create more than {max_chunks} chunks; "
                        "narrow the date range, use coarser chunks, or split the job"
                    )
            cursor = window_end

    if not chunks:
        raise PlanningError("Planning produced no chunks (range entirely outside availability)")
    return chunks, warnings


def plan_bars(
    instruments: list[InstrumentPlanInput],
    spec: BarSpec,
    range_start: datetime,
    range_end: datetime,
    *,
    now: datetime,
    max_chunks: int,
) -> tuple[list[PlannedChunk], list[str]]:
    return _plan(
        instruments,
        window_of=lambda _instrument: spec.window,
        availability=SECONDS_AVAILABILITY if spec.aggregation == "SECOND" else None,
        availability_label=f"bars of {spec.ib_size}",
        range_start=range_start,
        range_end=range_end,
        now=now,
        max_chunks=max_chunks,
    )


def plan_ticks(
    instruments: list[InstrumentPlanInput],
    range_start: datetime,
    range_end: datetime,
    *,
    now: datetime,
    max_chunks: int,
    stk_window: timedelta = timedelta(hours=1),
    fx_window: timedelta = timedelta(hours=24),
) -> tuple[list[PlannedChunk], list[str]]:
    return _plan(
        instruments,
        window_of=lambda instrument: stk_window if instrument.sec_type == "STK" else fx_window,
        availability=TICKS_AVAILABILITY,
        availability_label="historical ticks",
        range_start=range_start,
        range_end=range_end,
        now=now,
        max_chunks=max_chunks,
    )
