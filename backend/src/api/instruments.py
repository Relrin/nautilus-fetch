import asyncio
import json

from fastapi import APIRouter, HTTPException, Query, Request

from nautilus_fetch.ib.search import IBUnavailableError, InstrumentNotFoundError

router = APIRouter(prefix="/api/instruments")


@router.get("/search")
async def search_instruments(
    request: Request,
    q: str = Query(min_length=1, max_length=64),
    sec_type: str | None = Query(default=None, pattern=r"^[A-Z]{2,10}$"),
) -> list[dict]:
    try:
        return await request.app.state.search.search(q, sec_type=sec_type)
    except IBUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="IB search request timed out") from exc


@router.get("/{con_id}")
async def instrument_details(request: Request, con_id: int, refresh: bool = False) -> dict:
    try:
        row = await request.app.state.search.details(con_id, refresh=refresh)
    except InstrumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IBUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="IB contract details request timed out") from exc

    if row.get("details_json"):
        row = {**row, "details": json.loads(row["details_json"])}
        row.pop("details_json", None)
    return row
