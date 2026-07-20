import json
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

_NS = 1_000_000_000


class JobCreateRequest(BaseModel):
    con_ids: list[int] = Field(min_length=1, max_length=200)
    bar_size: str
    start: datetime
    end: datetime
    name: str | None = Field(default=None, max_length=200)
    data_type: Literal["BARS"] = "BARS"
    what_to_show: Literal["TRADES", "MIDPOINT", "BID", "ASK"] | None = None
    use_rth: bool = True
    workers: int | None = Field(default=None, ge=1, le=16)
    max_retries: int = Field(default=3, ge=0, le=10)

    @field_validator("start", "end")
    @classmethod
    def ensure_timezone(cls, value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _iso(ns: int | None) -> str | None:
    if ns is None:
        return None
    return datetime.fromtimestamp(ns / _NS, tz=UTC).isoformat()


def job_dto(row: dict[str, Any]) -> dict[str, Any]:
    total = row["total_chunks"] or 0
    settled = row["done_chunks"] + row["empty_chunks"] + row["failed_chunks"]
    return {
        "id": row["id"],
        "name": row["name"],
        "state": row["state"],
        "data_type": row["data_type"],
        "params": json.loads(row["params_json"] or "{}"),
        "workers": row["workers"],
        "max_retries": row["max_retries"],
        "range_start": _iso(row["range_start_ns"]),
        "range_end": _iso(row["range_end_ns"]),
        "total_chunks": total,
        "done_chunks": row["done_chunks"],
        "empty_chunks": row["empty_chunks"],
        "failed_chunks": row["failed_chunks"],
        "progress": round(settled / total, 4) if total else 0.0,
        "rows_written": row["rows_written"],
        "bytes_written": row["bytes_written"],
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }
