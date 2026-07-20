import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url


def _make_config(database_url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parent / "migrations"))
    # configparser interpolation: literal % in URLs (e.g. passwords) must be doubled
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return cfg


def upgrade_to_head(database_url: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    command.upgrade(_make_config(database_url), "head")


async def run_migrations(database_url: str) -> None:
    # alembic is sync and its env.py calls asyncio.run(); a worker thread keeps
    # that away from the app's running event loop
    await asyncio.to_thread(upgrade_to_head, database_url)
