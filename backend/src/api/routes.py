import sqlalchemy as sa
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api")


@router.get("/health")
async def health(request: Request) -> dict:
    from nautilus_fetch import __version__

    db_status = "ok"
    try:
        async with request.app.state.db.connect() as conn:
            await conn.execute(sa.text("SELECT 1"))
    except Exception as exc:
        db_status = f"error: {type(exc).__name__}"
    return {"status": "ok" if db_status == "ok" else "degraded", "version": __version__, "db": db_status}


@router.get("/ib/status")
async def ib_status(request: Request) -> dict:
    return request.app.state.ib_conn.status()
