"""SQLAlchemy Core schema — single source of truth for both SQLite and PostgreSQL.

Timestamps are integer epochs: ``*_ns`` columns are UTC nanoseconds (matching
Nautilus), ``*_at`` columns are UTC milliseconds.
"""

import sqlalchemy as sa

metadata = sa.MetaData()

instruments = sa.Table(
    "instruments",
    metadata,
    sa.Column("con_id", sa.BigInteger, primary_key=True, autoincrement=False),
    sa.Column("symbol", sa.Text, nullable=False),
    sa.Column("sec_type", sa.Text, nullable=False),
    sa.Column("exchange", sa.Text),
    sa.Column("primary_exchange", sa.Text),
    sa.Column("currency", sa.Text),
    sa.Column("description", sa.Text),
    sa.Column("instrument_id", sa.Text),  # Nautilus id, e.g. 'AAPL.NASDAQ'
    sa.Column("details_json", sa.Text),
    sa.Column("refreshed_at", sa.BigInteger),
    # Earliest data IB will serve, learned as a byproduct of job planning.
    sa.Column("head_timestamp_ns", sa.BigInteger),
)

schedules = sa.Table(
    "schedules",
    metadata,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("cron", sa.Text, nullable=False),
    sa.Column("enabled", sa.Integer, nullable=False, server_default="1"),
    sa.Column("catchup", sa.Integer, nullable=False, server_default="0"),
    sa.Column("job_template_json", sa.Text, nullable=False),
    sa.Column("last_run_at", sa.BigInteger),
    sa.Column("next_run_at", sa.BigInteger),
)

jobs = sa.Table(
    "jobs",
    metadata,
    sa.Column("id", sa.Text, primary_key=True),  # ULID
    sa.Column("name", sa.Text, nullable=False),
    # queued|running|paused|completed|completed_with_failures|canceled|failed
    sa.Column("state", sa.Text, nullable=False),
    sa.Column("data_type", sa.Text, nullable=False),  # BARS|TRADE_TICKS|QUOTE_TICKS|DEPTH
    # bar_size, use_rth, depth_levels, snapshot_interval_ms, capture_from/until, capture_window, ...
    sa.Column("params_json", sa.Text, nullable=False, server_default="{}"),
    sa.Column("workers", sa.Integer, nullable=False, server_default="4"),
    sa.Column("max_retries", sa.Integer, nullable=False, server_default="3"),
    sa.Column("range_start_ns", sa.BigInteger),
    sa.Column("range_end_ns", sa.BigInteger),  # NULL for open-ended DEPTH recorders
    sa.Column("schedule_id", sa.Text, sa.ForeignKey("schedules.id", ondelete="SET NULL")),
    sa.Column("total_chunks", sa.Integer, nullable=False, server_default="0"),
    sa.Column("done_chunks", sa.Integer, nullable=False, server_default="0"),
    sa.Column("empty_chunks", sa.Integer, nullable=False, server_default="0"),
    sa.Column("failed_chunks", sa.Integer, nullable=False, server_default="0"),
    sa.Column("rows_written", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("bytes_written", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("error", sa.Text),
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("updated_at", sa.BigInteger, nullable=False),
    sa.Column("started_at", sa.BigInteger),
    sa.Column("finished_at", sa.BigInteger),
)

job_symbols = sa.Table(
    "job_symbols",
    metadata,
    sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("con_id", sa.BigInteger, primary_key=True, autoincrement=False),
    sa.Column("instrument_id", sa.Text, nullable=False),
    sa.Column("ordinal", sa.Integer, nullable=False),
)

chunks = sa.Table(
    "chunks",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("con_id", sa.BigInteger, nullable=False),
    sa.Column("instrument_id", sa.Text, nullable=False),
    sa.Column("seq", sa.Integer, nullable=False),  # stable ordinal for chunk-map rendering
    sa.Column("range_start_ns", sa.BigInteger, nullable=False),
    sa.Column("range_end_ns", sa.BigInteger, nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default="pending"),  # pending|active|done|empty|failed
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("next_retry_at", sa.BigInteger),
    sa.Column("last_error_code", sa.Integer),
    sa.Column("last_error_msg", sa.Text),
    sa.Column("gap_warning", sa.Integer, nullable=False, server_default="0"),
    sa.Column("rows", sa.BigInteger),
    sa.Column("bytes", sa.BigInteger),
    sa.Column("started_at", sa.BigInteger),
    sa.Column("finished_at", sa.BigInteger),
    sa.Index("idx_chunks_job_state", "job_id", "state"),
    sa.Index("idx_chunks_job_seq", "job_id", "seq"),
)

chunk_attempts = sa.Table(
    "chunk_attempts",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("chunk_id", sa.Integer, sa.ForeignKey("chunks.id", ondelete="CASCADE"), nullable=False),
    sa.Column("attempt", sa.Integer, nullable=False),
    sa.Column("ts", sa.BigInteger, nullable=False),
    sa.Column("error_code", sa.Integer),
    sa.Column("error_msg", sa.Text),
    sa.Column("classification", sa.Text),
    sa.Index("idx_chunk_attempts_chunk", "chunk_id"),
)

throughput_samples = sa.Table(
    "throughput_samples",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("ts", sa.BigInteger, nullable=False),
    sa.Column("rows_per_s", sa.Float),
    sa.Column("bytes_per_s", sa.Float),
    sa.Column("inflight", sa.Integer),
    sa.Index("idx_throughput_job_ts", "job_id", "ts"),
)
