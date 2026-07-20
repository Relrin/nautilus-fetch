set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

dev:
    cd backend; uv run uvicorn nautilus_fetch.main:app --reload --port 8000

test:
    cd backend; uv run pytest

# Live smoke tests against a paper IB gateway (IB_HOST/IB_PORT env)
test-live:
    cd backend; uv run pytest -m ib_live -rA

sync:
    cd backend; uv sync --all-extras

docker-build:
    docker compose build

docker-up:
    docker compose up -d
