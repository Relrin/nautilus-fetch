from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from nautilus_fetch.db.schema import instruments


async def get(db: AsyncEngine, con_id: int) -> dict[str, Any] | None:
    async with db.connect() as conn:
        result = await conn.execute(sa.select(instruments).where(instruments.c.con_id == con_id))
        row = result.mappings().first()
    return dict(row) if row is not None else None


async def upsert(db: AsyncEngine, row: dict[str, Any]) -> None:
    # update-then-insert keeps this portable across SQLite and PostgreSQL
    async with db.begin() as conn:
        result = await conn.execute(
            sa.update(instruments).where(instruments.c.con_id == row["con_id"]).values(**row)
        )
        if result.rowcount == 0:
            await conn.execute(sa.insert(instruments).values(**row))


async def search_cached(db: AsyncEngine, query: str, limit: int = 50) -> list[dict[str, Any]]:
    pattern = f"%{query.upper()}%"
    async with db.connect() as conn:
        result = await conn.execute(
            sa.select(instruments)
            .where(sa.func.upper(instruments.c.symbol).like(pattern))
            .order_by(instruments.c.symbol)
            .limit(limit)
        )
        return [dict(row) for row in result.mappings()]
