# Spike: Convex self-hosted (ticket 02)

Oct 31, 2026. Throwaway toy app, not merged. **Verdict: [ADR 0002](./adr/0002-convex-backend.md) holds.** Self-hosted Convex in Docker ran streaming, resumable reads and aggregate rollups with no workarounds.

## Setup that worked

- Images: `ghcr.io/convex/convex-backend:latest` (revision `bb31399`, built 2026-10-24, 584 MB) and `convex-dashboard:latest` (487 MB). Components: `@convex-dev/persistent-text-streaming` 0.3.5, `@convex-dev/aggregate` 0.3.4, `convex` 1.49.0.
- Steps: the upstream `self-hosted/docker/docker-compose.yml` as-is, `docker compose up -d` (healthy in about 45 s on first pull), `docker compose exec backend ./generate_admin_key.sh`, then `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env.local` and `npx convex dev --once`. Both components installed on first deploy.
- Footprint at idle: backend about 30 MB RAM, dashboard about 340 MB. The dashboard is optional for end users.
- Data on the default SQLite volume survived a backend restart (aggregate totals unchanged).

## Results

| Check | Result |
| --- | --- |
| HTTP-driven stream (component's documented path), client reads to the end | 40/40 words over HTTP; DB body grew `0 → 5 → 9 ... → 40`, status `done` |
| Same, client disconnects after 1 s | Generation kept running server-side; DB reached 40 words, `done` |
| Server-driven stream: mutation schedules an internal action that writes chunks through the component every ~100 ms | DB reached 40 words, `done` |
| Subscriber joining mid-stream (simulated reload) over WebSocket | Saw the text so far immediately, then every flush (`12, 13, ... 40, done`) |
| `aggregate` sum and count by namespace | `sonnet` 3 rows / 10,401 micro-USD, `haiku` 1 / 250, correct; persisted across restart |

## Findings that change how ticket 05 is built

1. **Drive the stream from the server, not the browser.** The component's documented path is an HTTP action the browser calls, which needs CORS, its own auth check (the example endpoint accepts any `streamId` from anyone), and a "this tab is the driver" flag on the client. The server-driven path matches design doc section 4 exactly (send returns immediately, a scheduled action does the provider call) and worked with no browser involvement. It writes through the component's `lib.addChunk` mutation, which is not in the README; pin the component version and keep the call in one place.
2. **Flush on time, not on punctuation.** The documented `stream()` helper only writes to the database at sentence delimiters. The server-driven path lets us flush every ~100 ms as the design doc specifies.
3. **No stop API.** The component has no cancel. Stop (ticket 05) needs our own flag on the message that the streaming action checks between chunks, then aborts the provider request.
4. **Pin the images.** The upstream compose file uses `:latest`. The self-host packaging (phase 5) should pin a revision so every self-hoster runs the same backend.
5. **Port clash in development.** The default ports 3210 and 3211 are the same ones `npx convex dev` uses for local deployments. The spike ran on 3310 and 3311 via `PORT` and `SITE_PROXY_PORT`; the setup guide should mention both variables.
6. `/version` on this image returns `unknown`. It is harmless (the healthcheck only needs a 200), but don't use it to report the backend version.

## Not covered

- Postgres or MySQL as the database (SQLite default only)
- Convex Auth against the Docker backend (ticket 01 ran on a local `npx convex dev` deployment)
- Long provider calls near action time limits (`V8_ACTION_USER_TIMEOUT_SECS` is configurable)
- Load, many concurrent streams, and the search-index failure mode from the T3 Chat postmortem
