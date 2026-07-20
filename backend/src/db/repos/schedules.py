import time
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.schema import schedules


async def insert(db: AsyncEngine, row: dict[str, Any]) -> None:
    async with db.begin() as conn:
        await conn.execute(sa.insert(schedules).values(**row))


async def get(db: AsyncEngine, schedule_id: str) -> dict[str, Any] | None:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(schedules).where(schedules.c.id == schedule_id))
        row = result.mappings().first()
    return dict(row) if row is not None else None


async def list_all(db: AsyncEngine) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(schedules).order_by(schedules.c.name))
        return [dict(row) for row in result.mappings()]


async def list_enabled(db: AsyncEngine) -> list[dict[str, Any]]:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(schedules).where(schedules.c.enabled == 1))
        return [dict(row) for row in result.mappings()]


async def update(db: AsyncEngine, schedule_id: str, **values: Any) -> None:
    async with db.begin() as conn:
        await conn.execute(sa.update(schedules).where(schedules.c.id == schedule_id).values(**values))


async def delete(db: AsyncEngine, schedule_id: str) -> bool:
    async with db.begin() as conn:
        result = await conn.execute(sa.delete(schedules).where(schedules.c.id == schedule_id))
        return result.rowcount > 0


async def stamp_run(db: AsyncEngine, schedule_id: str, next_run_at_ms: int | None) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.update(schedules)
            .where(schedules.c.id == schedule_id)
            .values(last_run_at=int(time.time() * 1000), next_run_at=next_run_at_ms)
        )
