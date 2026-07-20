import json

from fastapi import APIRouter, HTTPException, Request
from ulid import ULID

from nautilus_fetch.api.schemas import (
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
    job_dto,
    schedule_dto,
)
from nautilus_fetch.db.repos import jobs as jobs_repo
from nautilus_fetch.db.repos import schedules as schedules_repo
from nautilus_fetch.engine.engine import JobValidationError
from nautilus_fetch.ib.search import IBUnavailableError, InstrumentNotFoundError
from nautilus_fetch.scheduler import ScheduleError, next_run_ms, validate_cron

router = APIRouter(prefix="/api/schedules")


@router.get("")
async def list_schedules(request: Request) -> list[dict]:
    rows = await schedules_repo.list_all(request.app.state.db)
    return [schedule_dto(row) for row in rows]


@router.post("", status_code=201)
async def create_schedule(request: Request, body: ScheduleCreateRequest) -> dict:
    try:
        validate_cron(body.cron)
    except ScheduleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    scheduler = request.app.state.scheduler
    row = {
        "id": str(ULID()),
        "name": body.name,
        "cron": body.cron,
        "enabled": 1 if body.enabled else 0,
        "catchup": 1 if body.catchup else 0,
        "job_template_json": json.dumps(body.template.model_dump()),
        "next_run_at": next_run_ms(body.cron, scheduler._now()) if body.enabled else None,
    }
    await schedules_repo.insert(request.app.state.db, row)
    return schedule_dto((await schedules_repo.get(request.app.state.db, row["id"])))


async def _schedule_or_404(request: Request, schedule_id: str) -> dict:
    row = await schedules_repo.get(request.app.state.db, schedule_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")
    return row


@router.get("/{schedule_id}")
async def get_schedule(request: Request, schedule_id: str) -> dict:
    return schedule_dto(await _schedule_or_404(request, schedule_id))


@router.put("/{schedule_id}")
async def update_schedule(request: Request, schedule_id: str, body: ScheduleUpdateRequest) -> dict:
    row = await _schedule_or_404(request, schedule_id)
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.cron is not None:
        try:
            validate_cron(body.cron)
        except ScheduleError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        updates["cron"] = body.cron
    if body.template is not None:
        updates["job_template_json"] = json.dumps(body.template.model_dump())
    if body.catchup is not None:
        updates["catchup"] = 1 if body.catchup else 0
    if body.enabled is not None:
        updates["enabled"] = 1 if body.enabled else 0

    cron = updates.get("cron", row["cron"])
    enabled = updates.get("enabled", row["enabled"])
    if enabled:
        # recompute on cron change or re-enable so the next firing is correct
        if "cron" in updates or ("enabled" in updates and not row["enabled"]):
            updates["next_run_at"] = next_run_ms(cron, request.app.state.scheduler._now())
    else:
        updates["next_run_at"] = None

    await schedules_repo.update(request.app.state.db, schedule_id, **updates)
    return schedule_dto(await _schedule_or_404(request, schedule_id))


@router.delete("/{schedule_id}", status_code=204)
async def delete_schedule(request: Request, schedule_id: str) -> None:
    await _schedule_or_404(request, schedule_id)
    await schedules_repo.delete(request.app.state.db, schedule_id)


@router.post("/{schedule_id}/run-now")
async def run_now(request: Request, schedule_id: str) -> dict:
    await _schedule_or_404(request, schedule_id)
    try:
        job = await request.app.state.scheduler.run_now(schedule_id)
    except (JobValidationError, ScheduleError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InstrumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IBUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if job is None:
        return {"job": None, "detail": "already up to date"}
    symbols = await jobs_repo.symbols_of(request.app.state.db, job["id"])
    dto = job_dto(job, [symbol["instrument_id"] for symbol in symbols])
    return {"job": dto, "detail": "job created"}
