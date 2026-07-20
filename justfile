set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

dev:
    cd backend; uv run uvicorn nautilus_fetch.main:app --reload --port 8000

test:
    cd backend; uv run pytest

sync:
    cd backend; uv sync --all-extras

docker-build:
    docker compose build

docker-up:
    docker compose up -d
