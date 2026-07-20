import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from nautilus_fetch import __version__
from nautilus_fetch.api.routes import router
from nautilus_fetch.config import Settings
from nautilus_fetch.db.engine import create_db_engine
from nautilus_fetch.db.migrate import run_migrations
from nautilus_fetch.ib.connection import IBConnectionManager

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
        logger.info("nautilus-fetch %s started", __version__)
        yield
        await app.state.ib_conn.stop()
        await app.state.db.dispose()

    app = FastAPI(title="nautilus-fetch", version=__version__, lifespan=lifespan)
    app.include_router(router)

    # Future frontend build lands in ./static (Docker copies it next to cwd).
    static_dir = Path("static")
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


app = create_app()
