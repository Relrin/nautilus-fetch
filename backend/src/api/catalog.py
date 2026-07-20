from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/catalog")


class ConsolidateRequest(BaseModel):
    data_type: str | None = Field(default=None, max_length=50)  # e.g. "bar"; None = whole catalog
    identifier: str | None = Field(default=None, max_length=200)
    # ensure_contiguous_files=True renames intervals to be gap-free, which does
    # not hold for market data with closed sessions -> default off
    ensure_contiguous_files: bool = False
    deduplicate: bool = False


@router.get("/summary")
async def catalog_summary(request: Request) -> dict:
    return await request.app.state.writer.summary()


@router.post("/consolidate")
async def consolidate(request: Request, body: ConsolidateRequest | None = None) -> dict:
    body = body or ConsolidateRequest()
    try:
        await request.app.state.writer.consolidate(
            data_type=body.data_type,
            identifier=body.identifier,
            ensure_contiguous_files=body.ensure_contiguous_files,
            deduplicate=body.deduplicate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "ok"}
