import time
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.schema import chunk_attempts, chunks


def _now_ms() -> int:
    return int(time.time() * 1000)


async def bulk_insert(db: AsyncEngine, rows: list[dict[str, Any]]) -> None:
    async with db.begin() as conn:
        await conn.execute(sa.insert(chunks), rows)


async def get(db: AsyncEngine, chunk_id: int) -> dict[str, Any] | None:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(chunks).where(chunks.c.id == chunk_id))
        row = result.mappings().first()
    return dict(row) if row is not None else None


async def pending_of_job(db: AsyncEngine, job_id: str) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(chunks.c.id, chunks.c.seq, chunks.c.next_retry_at)
            .where(chunks.c.job_id == job_id, chunks.c.state == "pending")
            .order_by(chunks.c.seq)
        )
        return [dict(row) for row in result.mappings()]


async def mark_active(db: AsyncEngine, chunk_id: int) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.update(chunks)
            .where(chunks.c.id == chunk_id)
            .values(state="active", started_at=_now_ms())
        )


async def mark_terminal(
    db: AsyncEngine,
    chunk_id: int,
    *,
    state: str,  # done|empty|failed
    rows: int | None = None,
    bytes_: int | None = None,
    error_code: int | None = None,
    error_msg: str | None = None,
    gap_warning: bool = False,
    attempts: int | None = None,
) -> None:
    values: dict[str, Any] = {"state": state, "finished_at": _now_ms()}
    if attempts is not None:
        values["attempts"] = attempts
    if rows is not None:
        values["rows"] = rows
    if bytes_ is not None:
        values["bytes"] = bytes_
    if error_code is not None:
        values["last_error_code"] = error_code
    if error_msg is not None:
        values["last_error_msg"] = error_msg[:2000]
    if gap_warning:
        values["gap_warning"] = 1
    async with db.begin() as conn:
        await conn.execute(sa.update(chunks).where(chunks.c.id == chunk_id).values(**values))


async def mark_retry(
    db: AsyncEngine,
    chunk_id: int,
    *,
    attempts: int,
    next_retry_at_ms: int | None,
    error_code: int | None,
    error_msg: str | None,
) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.update(chunks)
            .where(chunks.c.id == chunk_id)
            .values(
                state="pending",
                attempts=attempts,
                next_retry_at=next_retry_at_ms,
                last_error_code=error_code,
                last_error_msg=(error_msg or "")[:2000] or None,
            )
        )


async def add_attempt(
    db: AsyncEngine,
    chunk_id: int,
    *,
    attempt: int,
    error_code: int | None,
    error_msg: str | None,
    classification: str,
) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.insert(chunk_attempts).values(
                chunk_id=chunk_id,
                attempt=attempt,
                ts=_now_ms(),
                error_code=error_code,
                error_msg=(error_msg or "")[:2000] or None,
                classification=classification,
            )
        )


async def last_range_end_by_con(
    db: AsyncEngine, schedule_id: str, con_ids: list[int]
) -> dict[int, int]:
    """Per instrument: latest successfully fetched range end across a schedule's jobs."""
    from nautilus_fetch.db.schema import jobs

    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(chunks.c.con_id, sa.func.max(chunks.c.range_end_ns))
            .select_from(chunks.join(jobs, chunks.c.job_id == jobs.c.id))
            .where(
                jobs.c.schedule_id == schedule_id,
                chunks.c.con_id.in_(con_ids),
                chunks.c.state.in_(["done", "empty"]),
            )
            .group_by(chunks.c.con_id)
        )
        return {row[0]: int(row[1]) for row in result}


async def max_seq(db: AsyncEngine, job_id: str) -> int:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(sa.func.max(chunks.c.seq)).where(chunks.c.job_id == job_id)
        )
        value = result.scalar()
    return -1 if value is None else int(value)


async def reset_active_to_pending(db: AsyncEngine) -> int:
    """Startup recovery: chunks that were in flight when the process died."""
    async with db.begin() as conn:
        result = await conn.execute(
            sa.update(chunks).where(chunks.c.state == "active").values(state="pending")
        )
        return result.rowcount


async def reset_failed_to_pending(db: AsyncEngine, job_id: str) -> int:
    async with db.begin() as conn:
        result = await conn.execute(
            sa.update(chunks)
            .where(chunks.c.job_id == job_id, chunks.c.state == "failed")
            .values(state="pending", attempts=0, next_retry_at=None)
        )
        return result.rowcount


async def cells(db: AsyncEngine, job_id: str) -> list[tuple[int, str]]:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(chunks.c.seq, chunks.c.state)
            .where(chunks.c.job_id == job_id)
            .order_by(chunks.c.seq)
        )
        return [(row.seq, row.state) for row in result]


async def failures(db: AsyncEngine, job_id: str, limit: int = 200) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(chunks)
            .where(chunks.c.job_id == job_id, chunks.c.state == "failed")
            .order_by(chunks.c.seq)
            .limit(limit)
        )
        return [dict(row) for row in result.mappings()]
