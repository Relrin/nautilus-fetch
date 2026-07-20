# nautilus-fetch

Self-hosted manager for Interactive Brokers market data. Downloads historical
bars, trade ticks, and L1 quote ticks - and records live L2 depth snapshots —
into a [Nautilus Trader](https://nautilustrader.io) `ParquetDataCatalog` that is
directly usable in Nautilus backtests and polars/pyarrow training pipelines.

## Features

- **Instrument search** across everything IB carries - stocks, ETFs, futures,
  forex, and more - with contract details cached locally.
- **Historical OHLCV bars** for the full IB timeframe grid, from `1 secs` to
  `1 month`; MetaTrader-style aliases accepted (`M1`, `M15`, `H4`, `D1`, `W1`,
  `MN1`, ...).
- **Tick backfill**: historical trade ticks and L1 quote (bid/ask) ticks,
  cursored through IB's 1000-ticks-per-request API.
- **Live L2 depth recording** as `OrderBookDepth10` snapshots, with optional
  capture windows (absolute bounds and/or a recurring daily session, e.g.
  09:30-16:00 America/New_York on weekdays). IB has no historical depth API -
  recording is live-only, and stream interruptions are flagged per segment.
- **Job management**: chunk-level progress, pause/resume/cancel, one-click
  retry of failed chunks, automatic resume after restarts and gateway outages.
- **Live monitoring** over a single WebSocket: job state, chunk-map cells, and
  rows/s + MB/s throughput samples.
- **Recurring schedules** (cron) each trigger creates an incremental job that
  fetches only what is new since the last successful run.
- **IB pacing compliance built in** - every request passes a central gate that
  models IB's limits (~60 req/10 min, identical-request cooldown, BID_ASK
  double-counting), so jobs run at maximum safe speed without violations.
- **Nautilus-native output**: instruments and data land in a
  `ParquetDataCatalog`, loadable by `BacktestEngine` and by plain
  `polars.scan_parquet` alike, with an endpoint for consolidating small files.
- **Pluggable state store** - SQLite by default, PostgreSQL via a single
  `DATABASE_URL` switch

## Prerequisites
- Python 3.13
- [uv](https://docs.astral.sh/uv/) 

## Running locally (development)

### Start the backend
```sh
cd backend
uv sync --all-extras
uv run pytest                        # full suite, no IB gateway needed
uv run pytest -m ib_live             # live smoke tests against a paper gateway
uv run uvicorn nautilus_fetch.main:app --reload --port 8000
```

Configuration via environment or `.env` — see [.env.example](.env.example).
Defaults: paper gateway on `127.0.0.1:4002`, SQLite state, data under
`backend/data/`. Set `DATABASE_URL=postgresql+asyncpg://...` for PostgreSQL.

## Docker

```sh
cp .env.example .env    # set IB_HOST, STATE_DIR, CATALOG_DIR
docker compose up -d --build
```

Unraid notes:

- Point `IB_HOST` at your IB Gateway container (same custom network: container
  name; otherwise the host IP). `4002` = paper, `4001` = live.
- `IB_CLIENT_ID` must be unique per client on the same gateway - pick a free id
  if Nautilus or TWS also connect.
- `CATALOG_DIR` should be a share you also mount from your dev machine - the
  catalog is plain parquet, `polars.scan_parquet` works directly on it.
- The gateway restarts nightly: the app rides it out (state `degraded` /
  `disconnected`, automatic reconnect, chunks requeue without failing).

## Catalog layout

```
{CATALOG_DIR}/data/{type}/{identifier}/{start}_{end}.parquet
    bar/AAPL.NASDAQ-1-MINUTE-LAST-EXTERNAL/...
    trade_tick/AAPL.NASDAQ/...
    quote_tick/EUR·USD.IDEALPRO/...
    order_book_depth10/AAPL.NASDAQ/...
    equity/AAPL.NASDAQ/...
```

One file per chunk while downloading; `POST /api/catalog/consolidate` merges
small files (safe to run anytime — it serializes with active writes).


## Limits worth knowing

- Bars <= 30 s and historical ticks: only ~6 months back (IB limit; the planner
  clamps and warns).
- Historical ticks arrive ≤ 1000 per request with second-resolution timestamps;
  seconds with more than 1000 ticks cannot be fully retrieved (chunk gets
  `gap_warning`).
- Depth subscriptions are capped by `MAX_DEPTH_SUBSCRIPTIONS` (default 3,
  bounded by your IB market data lines).
- One process, one gateway socket, one client id is by design.

## License

nautilus-fetch is published under the BSD 3-Clause license. See [LICENSE](LICENSE) for details.

