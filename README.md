# nautilus-fetch

A self-hosted web app that helps to manage and download datasets via [IB Gateway](https://github.com/gnzsnz/ib-gateway-docker) 
in order to use for backtests & running along with the [Nautilus Trader](https://nautilustrader.io).

## Features

- **Instrument search** across everything IB carries - stocks, ETFs, futures,
  forex, and more - with contract details cached locally.
- **Historical data** can be downloaded and organized in different timeframes. Currently, 
  it ranges from from `1 secs` to `1 month`. Additionally, there are MetaTrader-style aliases accepted (e.g. `M1`, `M15`, `H4`, `D1`, `W1`,
  `MN1`).
- **Live L2 depth recording** as `OrderBookDepth10` snapshots, with optional
  capture windows (absolute bounds and/or a recurring daily session, e.g.
  09:30-16:00 America/New_York on weekdays). IB has no historical depth API -
  recording is live-only, and stream interruptions are flagged per segment
- **Cron job management**: chunk-level progress, pause/resume/cancel, one-click
  retry of failed chunks, automatic resume after restarts and gateway outages
- **A built-in dashboard** for tracking job state, chunk-map cells, and
  rows/s + MB/s throughput samples, etc
- **Retries and handling rate-limiting** - every request passes a central gate that
  models IB's limits (~60 req/10 min), so jobs run at maximum safe speed without violations
- **Nautilus-native output**: instruments and data land in a
  `ParquetDataCatalog`, loadable by `BacktestEngine` and by plain
  `polars.scan_parquet` alike, with an endpoint for consolidating small files together

***NOTE: Fetching L1/L2 market data will work only if you have paid for extra subscriptions***

## Prerequisites
- Python 3.13
- [uv](https://docs.astral.sh/uv/)

## Running locally (development)

### Using the backend
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
The entire application (backend + frontend) can be made into the regular container and deployed to 
your infrastructure or local server.

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
In order to make it compatible with Nautilus, there are some expectations on the structure
of directories. Shortly speaking, it can be described this way:
```
{CATALOG_DIR}/data/{type}/{identifier}/{start}_{end}.parquet
    bar/AAPL.NASDAQ-1-MINUTE-LAST-EXTERNAL/...
    trade_tick/AAPL.NASDAQ/...
    quote_tick/EUR·USD.IDEALPRO/...
    order_book_depth10/AAPL.NASDAQ/...
    equity/AAPL.NASDAQ/...
```

## Limits worth knowing

- Bars <= 30 s and historical ticks: only ~6 months back (IB limit; the planner
  clamps and warns)
- Historical ticks arrive ≤ 1000 per request with second-resolution timestamps;
  seconds with more than 1000 ticks cannot be fully retrieved (chunk gets
  `gap_warning`)
- Depth subscriptions are capped by `MAX_DEPTH_SUBSCRIPTIONS` (default 3,
  bounded by your IB market data lines)
- One process, one gateway socket, one client id is by design

## License

nautilus-fetch is published under the BSD 3-Clause license. See [LICENSE](LICENSE) for details.

