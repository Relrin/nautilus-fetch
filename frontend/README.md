# nautilus-dataset-fetch-dashboard

Used stack:
- TypeScript 6
- React 19 
- Vite 
- Tailwind v4 
- shadcn/ui

## Running it

Node **>= 22.12** (`engines` in `package.json`).

```bash
npm ci                 # or: just web-install
npm run dev            # :5173, proxies /api and /ws to 127.0.0.1:8000
```

The backend has to be up separately — from the repo root, `just dev`.

> Use **`127.0.0.1`, not `localhost`**, if you override `VITE_API_TARGET`. Node
> resolves `localhost` to `::1` first while uvicorn binds IPv4, and that
> surfaces through the Vite proxy as a bare `ECONNREFUSED`.

## Gates

```bash
npm run lint && npm run typecheck && npm test && npm run format:check && npm run build
```

or `just web-check` from the repo root. `just check` adds the backend tests.

`npm run build` writes to **`../backend/static`**, which is where `main.py`
mounts `StaticFiles`. In Docker the same build runs in a `node` stage and the
bundle is copied to `/app/static`.

## Project layout

```
src/
  api/        wire types, fetch client, unit normalisation, query keys, hooks
  ws/         socket client, frame merge (applyFrame), reconnect + re-sync
  domain/     job/schedule/catalog views, form rules
  lib/        cn, formatters, constants, rate limiting
  state/      selection (page + selected ids), toasts
  components/ 
    ui/       vendored shadcn, 
    ndm/      design-system primitives
  features/   topbar, instruments, queue, inspector, newjob, schedules, catalog
```

