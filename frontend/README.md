# 0penRX Frontend

The user-facing drug price lookup UI.

## Current state

The initial UI lives in the repository root as [`index.html`](../index.html) —
a single-file static page (no build step). It can be opened directly in a
browser or served by any static file server.

## Running locally

```
# from the repo root
python -m http.server 8080
# then open http://localhost:8080/index.html
```

## Roadmap

- Wire the search form to the backend `/prices` endpoint.
- Show ranked results (cheapest first) with pharmacy and source.
- Add ZIP-based filtering once geolocation data is available.
- Migrate to a component framework (React) if/when the UI grows beyond a
  single page.

## Backend contract

The UI consumes the API documented in the backend service:

- `GET /prices?drug=<name>&zip=<zip>` — returns ranked price records.
- `GET /health` — liveness check.

Record fields follow [`docs/SCHEMA.md`](../docs/SCHEMA.md).
