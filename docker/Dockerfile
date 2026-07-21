# ---------------------------------------------------------------- frontend --
# The repo layout is mirrored here on purpose: `vite.config.ts` resolves its
# outDir to `../backend/static`, so building from /src/frontend puts the bundle
# at /src/backend/static. The output path stays defined in exactly one place
# rather than being repeated as a Docker path that could drift from the config.
FROM node:22.12-alpine AS web

WORKDIR /src/frontend

# Manifests first, so `npm ci` stays cached until dependencies actually change.
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci

COPY frontend/ ./
# `tsc -b && vite build` — a type error fails the image build rather than
# shipping a bundle nobody type-checked.
RUN npm run build

# ----------------------------------------------------------------- runtime --
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

# `main.py` mounts `Path("static")` relative to the working directory, and
# WORKDIR is /app — so the bundle has to land exactly here to be served.
COPY --from=web /src/backend/static /app/static

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "nautilus_fetch.main:app", "--host", "0.0.0.0", "--port", "8000"]
