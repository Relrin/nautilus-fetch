# nautilus-fetch

Self-hosted manager for downloading Interactive Brokers historical market data
(bars, trade ticks, L1 quote ticks) and recording live L2 depth snapshots into a
[Nautilus Trader](https://nautilustrader.io) `ParquetDataCatalog`, ready for
backtests and polars/pyarrow training pipelines.

**Status: early development.** Backend milestone M0 (skeleton + IB Gateway
connectivity). The web frontend lives in `frontend/` and is developed separately.

## Development

Requires [uv](https://docs.astral.sh/uv/); it provisions Python 3.13 automatically.

```sh
cd backend
uv sync --all-extras
uv run pytest          # test suite (no IB gateway needed)
uv run uvicorn nautilus_fetch.main:app --reload --port 8000
```

Configuration comes from environment variables or `.env` — see
[.env.example](.env.example). Defaults target a paper IB Gateway on
`127.0.0.1:4002` and write state/catalog under `backend/data/`.

## Docker

```sh
cp .env.example .env   # adjust IB_HOST, STATE_DIR, CATALOG_DIR
docker compose up -d --build
```

Full documentation (Unraid notes, scheduling, catalog layout) arrives with the
final milestone.
