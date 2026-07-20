import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from nautilus_fetch import __version__
from nautilus_fetch.api.instruments import router as instruments_router
from nautilus_fetch.api.jobs import router as jobs_router
from nautilus_fetch.api.routes import router
from nautilus_fetch.api.ws import WsHub
from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.engine.engine import JobEngine
from nautilus_fetch.engine.throughput import ThroughputTracker
from nautilus_fetch.engine.writer import CatalogWriter
from nautilus_fetch.ib.connection import IBConnectionManager
from nautilus_fetch.ib.search import InstrumentSearchService
from nautilus_fetch.pacing import PacingGate

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await run_migrations(app_settings.database_url)
        app.state.settings = app_settings
        app.state.db = create_db_engine(app_settings.database_url)
        app.state.ib_conn = IBConnectionManager(
            app_settings.ib_host,
            app_settings.ib_port,
            app_settings.ib_client_id,
            connect_timeout_s=app_settings.ib_connect_timeout_s,
            backoff_initial_s=app_settings.ib_reconnect_backoff_initial_s,
            backoff_max_s=app_settings.ib_reconnect_backoff_max_s,
        )
        await app.state.ib_conn.start()
        app.state.search = InstrumentSearchService(app.state.ib_conn, app.state.db)
        app.state.hub = WsHub(batch_ms=app_settings.ws_batch_ms)
        await app.state.hub.start()
        app.state.pacing = PacingGate(
            max_requests=app_settings.pacing_max_requests,
            window_s=app_settings.pacing_window_s,
            identical_cooldown_s=app_settings.pacing_identical_cooldown_s,
            contract_burst=app_settings.pacing_contract_burst,
            contract_burst_window_s=app_settings.pacing_contract_burst_window_s,
        )
        app.state.writer = CatalogWriter(app_settings.catalog_path)
        app.state.throughput = ThroughputTracker(
            app.state.db,
            app.state.hub,
            interval_s=app_settings.throughput_sample_interval_s,
            persist_every=app_settings.throughput_persist_every,
            retention_h=app_settings.throughput_retention_h,
        )
        await app.state.throughput.start()
        app.state.engine = JobEngine(
            db=app.state.db,
            conn=app.state.ib_conn,
            pacing=app.state.pacing,
            writer=app.state.writer,
            search=app.state.search,
            settings=app_settings,
            hub=app.state.hub,
            throughput=app.state.throughput,
        )
        await app.state.engine.start()
        logger.info("nautilus-fetch %s started", __version__)
        yield
        await app.state.engine.stop()
        await app.state.throughput.stop()
        await app.state.hub.stop()
        await app.state.ib_conn.stop()
        await app.state.db.dispose()

    app = FastAPI(title="nautilus-fetch", version=__version__, lifespan=lifespan)
    app.include_router(router)
    app.include_router(instruments_router)
    app.include_router(jobs_router)

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        await websocket.app.state.hub.handle(websocket)

    # Future frontend build lands in ./static (Docker copies it next to cwd).
    static_dir = Path("static")
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


app = create_app()
