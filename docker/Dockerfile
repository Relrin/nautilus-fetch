FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.10.12 /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock backend/.python-version /app/
RUN uv sync --frozen --no-install-project --no-dev

COPY backend/src /app/src
RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "nautilus_fetch.main:app", "--host", "0.0.0.0", "--port", "8000"]
