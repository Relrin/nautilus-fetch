import json
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_NS = 1_000_000_000


class CaptureWindowModel(BaseModel):
    start: str = Field(pattern=r"^\d{2}:\d{2}(:\d{2})?$")  # "09:30"
    end: str = Field(pattern=r"^\d{2}:\d{2}(:\d{2})?$")  # "16:00"
    tz: str = "UTC"  # IANA name, e.g. "America/New_York"
    days: list[int] = Field(default=[0, 1, 2, 3, 4], max_length=7)  # 0=Mon .. 6=Sun


class JobCreateRequest(BaseModel):
    con_ids: list[int] = Field(min_length=1, max_length=200)
    start: datetime | None = None  # optional for DEPTH (defaults to now)
    end: datetime | None = None  # required for backfills; optional for DEPTH
    data_type: Literal["BARS", "TRADE_TICKS", "QUOTE_TICKS", "DEPTH"] = "BARS"
    bar_size: str | None = None  # required when data_type == BARS
    name: str | None = Field(default=None, max_length=200)
    what_to_show: Literal["TRADES", "MIDPOINT", "BID", "ASK"] | None = None  # BARS only
    use_rth: bool = True
    workers: int | None = Field(default=None, ge=1, le=16)
    max_retries: int = Field(default=3, ge=0, le=10)
    # DEPTH recorder options
    depth_levels: int | None = Field(default=None, ge=1, le=10)
    snapshot_interval_ms: int | None = Field(default=None, ge=0, le=60_000)
    capture_from: datetime | None = None
    capture_until: datetime | None = None
    capture_window: CaptureWindowModel | None = None

    @field_validator("start", "end", "capture_from", "capture_until")
    @classmethod
    def ensure_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @model_validator(mode="after")
    def check_data_type_params(self) -> "JobCreateRequest":
        if self.data_type == "BARS" and not self.bar_size:
            raise ValueError("bar_size is required for BARS jobs")
        if self.data_type != "BARS" and self.what_to_show is not None:
            raise ValueError("what_to_show only applies to BARS jobs")
        if self.data_type == "DEPTH":
            if self.end is not None:
                raise ValueError("DEPTH recorders are open-ended; use capture_until instead of end")
        else:
            if self.start is None or self.end is None:
                raise ValueError("start and end are required for backfill jobs")
            depth_fields = (
                self.depth_levels,
                self.snapshot_interval_ms,
                self.capture_from,
                self.capture_until,
                self.capture_window,
            )
            if any(field is not None for field in depth_fields):
                raise ValueError("depth/capture options only apply to DEPTH jobs")
        return self


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
