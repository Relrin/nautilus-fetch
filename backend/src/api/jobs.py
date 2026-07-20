import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request

from nautilus_fetch.api.schemas import JobCreateRequest, job_dto
from nautilus_fetch.api.ws import CHUNK_STATE_CODES
from nautilus_fetch.db.repos import chunks as chunks_repo
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.db.repos import samples as samples_repo
from nautilus_fetch.engine.engine import (
    JobNotFoundError,
    JobSpec,
    JobValidationError,
)
from nautilus_fetch.ib.search import IBUnavailableError, InstrumentNotFoundError

router = APIRouter(prefix="/api/jobs")


def _engine(request: Request):
    return request.app.state.engine


@router.post("", status_code=201)
async def create_job(request: Request, body: JobCreateRequest) -> dict:
    spec = JobSpec(
        con_ids=body.con_ids,
        data_type=body.data_type,
        bar_size=body.bar_size,
        range_start=body.start or datetime.now(UTC),
        range_end=body.end,
        name=body.name,
        what_to_show=body.what_to_show,
        use_rth=body.use_rth,
        workers=body.workers,
        max_retries=body.max_retries,
        depth_levels=body.depth_levels,
        snapshot_interval_ms=body.snapshot_interval_ms,
        capture_from=body.capture_from,
        capture_until=body.capture_until,
        capture_window=body.capture_window.model_dump() if body.capture_window else None,
    )
    try:
        job, warnings = await _engine(request).submit(spec)
    except JobValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InstrumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IBUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {**job_dto(job), "warnings": warnings}


@router.get("")
async def list_jobs(
    request: Request,
    state: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    rows = await jobs_repo.list_jobs(request.app.state.db, state=state, limit=limit, offset=offset)
    return [job_dto(row) for row in rows]


async def _job_or_404(request: Request, job_id: str) -> dict:
    row = await jobs_repo.get(request.app.state.db, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return row


@router.get("/{job_id}")
async def get_job(request: Request, job_id: str) -> dict:
    return job_dto(await _job_or_404(request, job_id))


@router.delete("/{job_id}")
async def cancel_job(request: Request, job_id: str) -> dict:
    await _job_or_404(request, job_id)
    return job_dto(await _engine(request).cancel(job_id))


@router.post("/{job_id}/pause")
async def pause_job(request: Request, job_id: str) -> dict:
    await _job_or_404(request, job_id)
    try:
        return job_dto(await _engine(request).pause(job_id))
    except JobValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{job_id}/resume")
async def resume_job(request: Request, job_id: str) -> dict:
    await _job_or_404(request, job_id)
    try:
        return job_dto(await _engine(request).resume(job_id))
    except JobValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{job_id}/retry-failed")
async def retry_failed(request: Request, job_id: str) -> dict:
    await _job_or_404(request, job_id)
    try:
        return job_dto(await _engine(request).retry_failed(job_id))
    except JobValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/stop")
async def stop_recorder(request: Request, job_id: str) -> dict:
    """Finalize a DEPTH recorder: flush buffered segments and complete the job."""
    await _job_or_404(request, job_id)
    try:
        return job_dto(await _engine(request).stop_recorder(job_id))
    except JobValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{job_id}/chunks")
async def job_chunks(request: Request, job_id: str) -> dict:
    job = await _job_or_404(request, job_id)
    cells = await chunks_repo.cells(request.app.state.db, job_id)
    return {
        "total": job["total_chunks"],
        "state_codes": CHUNK_STATE_CODES,
        "cells": [[seq, CHUNK_STATE_CODES[state]] for seq, state in cells],
    }


@router.get("/{job_id}/throughput")
async def job_throughput(
    request: Request,
    job_id: str,
    window: int = Query(default=600, ge=10, le=86_400),
) -> dict:
    await _job_or_404(request, job_id)
    tracker = getattr(request.app.state, "throughput", None)
    samples = tracker.recent(job_id, window) if tracker is not None else None
    source = "live"
    if samples is None:  # job not actively tracked: serve persisted samples
        since_ms = int((time.time() - window) * 1000)
        samples = await samples_repo.recent(request.app.state.db, job_id, since_ms)
        source = "persisted"
    return {"window_s": window, "source": source, "samples": samples}


@router.get("/{job_id}/failures")
async def job_failures(request: Request, job_id: str) -> list[dict]:
    await _job_or_404(request, job_id)
    rows = await chunks_repo.failures(request.app.state.db, job_id)
    return [
        {
            "chunk_id": row["id"],
            "seq": row["seq"],
            "instrument_id": row["instrument_id"],
            "range_start_ns": row["range_start_ns"],
            "range_end_ns": row["range_end_ns"],
            "attempts": row["attempts"],
            "error_code": row["last_error_code"],
            "error": row["last_error_msg"],
        }
        for row in rows
    ]
