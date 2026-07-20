"""Split a job's (instruments x date range) into chunks.

A BARS chunk maps to exactly one reqHistoricalData call, which makes pacing
accounting trivial: chunks consumed == requests sent.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from nautilus_fetch.engine.barsize import SECONDS_AVAILABILITY, BarSpec

_NS = 1_000_000_000


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


def _skip_weekend(moment: datetime, sec_type: str, spec: BarSpec) -> bool:
    # Cheap heuristic for sub-day windows on equities: whole-weekend chunks are
    # guaranteed empty. FX/futures trade around the clock; anything else that
    # slips through simply completes as an empty chunk.
    return sec_type == "STK" and spec.window.days <= 1 and moment.weekday() in (5, 6)


@dataclass(frozen=True)
class InstrumentPlanInput:
    con_id: int
    instrument_id: str
    sec_type: str
    head_timestamp: datetime | None = None  # earliest data IB has, when known


def plan_bars(
    instruments: list[InstrumentPlanInput],
    spec: BarSpec,
    range_start: datetime,
    range_end: datetime,
    *,
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
        start = range_start
        if spec.aggregation == "SECOND":
            available_from = now.astimezone(UTC) - SECONDS_AVAILABILITY
            if start < available_from:
                warnings.append(
                    f"{instrument.instrument_id}: bars of {spec.ib_size} are only available "
                    f"for ~6 months; range clamped to {available_from.isoformat()}"
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
            window_end = min(cursor + spec.window, range_end)
            if not _skip_weekend(cursor, instrument.sec_type, spec):
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
                        "narrow the date range, use a coarser bar size, or split the job"
                    )
            cursor = window_end

    if not chunks:
        raise PlanningError("Planning produced no chunks (range entirely outside availability)")
    return chunks, warnings
