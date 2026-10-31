# Convex as the backend, without the Agent component

Convex is the backend because branching threads, resumable streams and cross-device sync are its native shape, and it self-hosts with Docker Compose (SQLite by default). Its weak spot for this product, metering rollups with no `GROUP BY`, is covered by `@convex-dev/aggregate`, and streaming uses `persistent-text-streaming`. We deliberately skip the Convex Agent component: it brings its own thread and message model, which would fight the append-only message tree (ADR 0001).

## Considered Options

- **Postgres + Redis + a custom sync layer**: full SQL for metering, but resumable streams and live sync become our own code. T3 Chat tried this path and left it.
- **Convex Agent component**: less code for threads and usage tracking, but its message model has no checkpoints or cache-aware assembly.

## Consequences

- The data access layer is not portable; leaving Convex means rewriting it.
- Rollup dimensions are still chosen up front; adding one later means a backfill.
- Self-hosters inherit Convex self-host maturity (community support only).
