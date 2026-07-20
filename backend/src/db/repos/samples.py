from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.schema import throughput_samples


async def insert_many(db: AsyncEngine, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    async with db.begin() as conn:
        await conn.execute(sa.insert(throughput_samples), rows)


async def recent(db: AsyncEngine, job_id: str, since_ms: int) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(
                throughput_samples.c.ts,
                throughput_samples.c.rows_per_s,
                throughput_samples.c.bytes_per_s,
                throughput_samples.c.inflight,
            )
            .where(throughput_samples.c.job_id == job_id, throughput_samples.c.ts >= since_ms)
            .order_by(throughput_samples.c.ts)
        )
        return [dict(row) for row in result.mappings()]


async def prune(db: AsyncEngine, before_ms: int) -> int:
    async with db.begin() as conn:
        result = await conn.execute(
            sa.delete(throughput_samples).where(throughput_samples.c.ts < before_ms)
        )
        return result.rowcount
