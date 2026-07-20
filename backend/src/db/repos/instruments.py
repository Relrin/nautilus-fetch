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


async def list_cached(
    db: AsyncEngine,
    query: str | None = None,
    sec_type: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Every instrument this server has looked up, newest-seen first.

    Serves the dashboard sidebar without touching IB, so it costs no pacing
    budget and is shared across browsers.
    """
    statement = sa.select(instruments)
    if query:
        pattern = f"%{query.upper()}%"
        statement = statement.where(
            sa.or_(
                sa.func.upper(instruments.c.symbol).like(pattern),
                sa.func.upper(sa.func.coalesce(instruments.c.description, "")).like(pattern),
            )
        )
    if sec_type:
        statement = statement.where(instruments.c.sec_type == sec_type)
    statement = statement.order_by(
        instruments.c.refreshed_at.desc().nullslast(), instruments.c.symbol
    ).limit(limit)
    async with db.connect() as conn:
        result = await conn.execute(statement)
        return [dict(row) for row in result.mappings()]


async def set_head_timestamp(db: AsyncEngine, con_id: int, head_ns: int) -> None:
    async with db.begin() as conn:
        await conn.execute(
            sa.update(instruments)
            .where(instruments.c.con_id == con_id)
            .values(head_timestamp_ns=head_ns)
        )
