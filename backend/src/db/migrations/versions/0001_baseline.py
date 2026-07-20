"""Baseline schema: instruments, schedules, jobs, job_symbols, chunks, chunk_attempts, throughput_samples.

Revision ID: 0001
Revises:
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instruments",
        sa.Column("con_id", sa.BigInteger, primary_key=True, autoincrement=False),
        sa.Column("symbol", sa.Text, nullable=False),
        sa.Column("sec_type", sa.Text, nullable=False),
        sa.Column("exchange", sa.Text),
        sa.Column("primary_exchange", sa.Text),
        sa.Column("currency", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("instrument_id", sa.Text),
        sa.Column("details_json", sa.Text),
        sa.Column("refreshed_at", sa.BigInteger),
        sa.Column("head_timestamp_ns", sa.BigInteger),
    )
    op.create_table(
        "schedules",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("cron", sa.Text, nullable=False),
        sa.Column("enabled", sa.Integer, nullable=False, server_default="1"),
        sa.Column("catchup", sa.Integer, nullable=False, server_default="0"),
        sa.Column("job_template_json", sa.Text, nullable=False),
        sa.Column("last_run_at", sa.BigInteger),
        sa.Column("next_run_at", sa.BigInteger),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("state", sa.Text, nullable=False),
        sa.Column("data_type", sa.Text, nullable=False),
        sa.Column("params_json", sa.Text, nullable=False, server_default="{}"),
        sa.Column("workers", sa.Integer, nullable=False, server_default="4"),
        sa.Column("max_retries", sa.Integer, nullable=False, server_default="3"),
        sa.Column("range_start_ns", sa.BigInteger),
        sa.Column("range_end_ns", sa.BigInteger),
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
    op.create_table(
        "job_symbols",
        sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("con_id", sa.BigInteger, primary_key=True, autoincrement=False),
        sa.Column("instrument_id", sa.Text, nullable=False),
        sa.Column("ordinal", sa.Integer, nullable=False),
    )
    op.create_table(
        "chunks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("con_id", sa.BigInteger, nullable=False),
        sa.Column("instrument_id", sa.Text, nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("range_start_ns", sa.BigInteger, nullable=False),
        sa.Column("range_end_ns", sa.BigInteger, nullable=False),
        sa.Column("state", sa.Text, nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.BigInteger),
        sa.Column("last_error_code", sa.Integer),
        sa.Column("last_error_msg", sa.Text),
        sa.Column("gap_warning", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows", sa.BigInteger),
        sa.Column("bytes", sa.BigInteger),
        sa.Column("started_at", sa.BigInteger),
        sa.Column("finished_at", sa.BigInteger),
    )
    op.create_index("idx_chunks_job_state", "chunks", ["job_id", "state"])
    op.create_index("idx_chunks_job_seq", "chunks", ["job_id", "seq"])
    op.create_table(
        "chunk_attempts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("chunk_id", sa.Integer, sa.ForeignKey("chunks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt", sa.Integer, nullable=False),
        sa.Column("ts", sa.BigInteger, nullable=False),
        sa.Column("error_code", sa.Integer),
        sa.Column("error_msg", sa.Text),
        sa.Column("classification", sa.Text),
    )
    op.create_index("idx_chunk_attempts_chunk", "chunk_attempts", ["chunk_id"])
    op.create_table(
        "throughput_samples",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Text, sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ts", sa.BigInteger, nullable=False),
        sa.Column("rows_per_s", sa.Float),
        sa.Column("bytes_per_s", sa.Float),
        sa.Column("inflight", sa.Integer),
    )
    op.create_index("idx_throughput_job_ts", "throughput_samples", ["job_id", "ts"])


def downgrade() -> None:
    for table in (
        "throughput_samples",
        "chunk_attempts",
        "chunks",
        "job_symbols",
        "jobs",
        "schedules",
        "instruments",
    ):
        op.drop_table(table)
