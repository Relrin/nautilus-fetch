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

# Frontend dev server on :5173, proxying /api and /ws to 127.0.0.1:8000
web:
    cd frontend; npm run dev

web-install:
    cd frontend; npm ci

# Production bundle into backend/static, where main.py mounts it.
web-build:
    cd frontend; npm run build

web-check:
    cd frontend; npm run lint
    cd frontend; npm run typecheck
    cd frontend; npm test
    cd frontend; npm run format:check
    cd frontend; npm run build

check: test web-check

docker-build:
    docker compose build

docker-up:
    docker compose up -d
