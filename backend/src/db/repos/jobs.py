import time
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.schema import job_symbols, jobs


def _now_ms() -> int:
    return int(time.time() * 1000)


async def insert(db: AsyncEngine, row: dict[str, Any], symbols: list[dict[str, Any]]) -> None:
    async with db.begin() as conn:
        await conn.execute(sa.insert(jobs).values(**row))
        if symbols:
            await conn.execute(sa.insert(job_symbols), symbols)


async def get(db: AsyncEngine, job_id: str) -> dict[str, Any] | None:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(jobs).where(jobs.c.id == job_id))
        row = result.mappings().first()
    return dict(row) if row is not None else None


async def list_jobs(
    db: AsyncEngine,
    state: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = sa.select(jobs).order_by(jobs.c.created_at.desc()).limit(limit).offset(offset)
    if state:
        query = query.where(jobs.c.state == state)
    async with db.connect() as conn:
        result = await conn.execute(query)
        return [dict(row) for row in result.mappings()]


async def list_by_states(db: AsyncEngine, states: list[str]) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(jobs).where(jobs.c.state.in_(states)))
        return [dict(row) for row in result.mappings()]


async def update(db: AsyncEngine, job_id: str, **values: Any) -> None:
    values["updated_at"] = _now_ms()
    async with db.begin() as conn:
        await conn.execute(sa.update(jobs).where(jobs.c.id == job_id).values(**values))


async def bump_counters(
    db: AsyncEngine,
    job_id: str,
    *,
    done: int = 0,
    empty: int = 0,
    failed: int = 0,
    rows: int = 0,
    bytes_: int = 0,
    total: int = 0,  # DEPTH recorders grow total_chunks as segments flush
) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.update(jobs)
            .where(jobs.c.id == job_id)
            .values(
                total_chunks=jobs.c.total_chunks + total,
                done_chunks=jobs.c.done_chunks + done,
                empty_chunks=jobs.c.empty_chunks + empty,
                failed_chunks=jobs.c.failed_chunks + failed,
                rows_written=jobs.c.rows_written + rows,
                bytes_written=jobs.c.bytes_written + bytes_,
                updated_at=_now_ms(),
            )
        )


async def symbols_of(db: AsyncEngine, job_id: str) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(job_symbols).where(job_symbols.c.job_id == job_id).order_by(job_symbols.c.ordinal)
        )
        return [dict(row) for row in result.mappings()]


async def symbols_for(db: AsyncEngine, job_ids: list[str]) -> dict[str, list[str]]:
    """Instrument ids per job in one query — the list endpoint must not go N+1."""
    if not job_ids:
        return {}
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(job_symbols.c.job_id, job_symbols.c.instrument_id)
            .where(job_symbols.c.job_id.in_(job_ids))
            .order_by(job_symbols.c.job_id, job_symbols.c.ordinal)
        )
        grouped: dict[str, list[str]] = {job_id: [] for job_id in job_ids}
        for row in result:
            grouped[row.job_id].append(row.instrument_id)
    return grouped
