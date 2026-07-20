import sqlalchemy as sa

from nautilus_fetch.db.migrate import upgrade_to_head
from nautilus_fetch.db.schema import metadata


def test_migrations_create_all_tables(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path.as_posix()}/mig.sqlite"
    upgrade_to_head(url)
    upgrade_to_head(url)  # idempotent: second run is a no-op

    engine = sa.create_engine(f"sqlite:///{tmp_path.as_posix()}/mig.sqlite")
    try:
        inspector = sa.inspect(engine)
        tables = set(inspector.get_table_names())
        assert set(metadata.tables) <= tables
        assert "alembic_version" in tables
        chunk_indexes = {index["name"] for index in inspector.get_indexes("chunks")}
        assert {"idx_chunks_job_state", "idx_chunks_job_seq"} <= chunk_indexes
        for table_name, table in metadata.tables.items():
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            assert set(table.columns.keys()) <= columns, table_name
    finally:
        engine.dispose()
