from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # IB Gateway connection
    ib_host: str = "127.0.0.1"
    ib_port: int = 4002  # 4002 = paper gateway, 4001 = live gateway
    ib_client_id: int = 17
    ib_connect_timeout_s: float = 10.0
    ib_reconnect_backoff_initial_s: float = 2.0
    ib_reconnect_backoff_max_s: float = 60.0
    ib_request_timeout_s: float = 120.0

    # Storage. Relative defaults are dev-friendly; Docker sets absolute paths.
    catalog_path: Path = Path("data/catalog")
    database_url: str = "sqlite+aiosqlite:///data/state/nautilus-fetch.sqlite"

    # IB pacing: hard limit is ~60 historical requests per 600s; keep a margin.
    pacing_max_requests: int = 55
    pacing_window_s: float = 600.0
    pacing_identical_cooldown_s: float = 15.0
    pacing_contract_burst: int = 5
    pacing_contract_burst_window_s: float = 2.0
    pacing_violation_cooldown_s: float = 60.0

    # Job engine
    default_workers: int = 4
    max_workers: int = 8
    max_chunks_per_job: int = 50_000
    max_depth_subscriptions: int = 3
    retry_backoff_base_s: float = 5.0
    retry_backoff_max_s: float = 300.0

    # API
    ws_batch_ms: int = 500
