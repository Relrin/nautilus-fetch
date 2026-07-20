import pytest

from nautilus_fetch.config import Settings


@pytest.fixture
def tmp_settings(tmp_path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path.as_posix()}/state.sqlite",
        catalog_path=tmp_path / "catalog",
        ib_host="127.0.0.1",
        ib_port=1,  # nothing listens here: connect fails fast in tests
        _env_file=None,
    )
