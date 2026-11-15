# Spec: Phase 5, self-host packaging

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) section 9 phase 5, section 10 "Open source" · Respects [ADR 0002](../adr/0002-convex-backend.md) · Builds on the [self-host spike](../spike-convex-self-host.md) and [self-hosting notes](../self-hosting-notes.md)

## Problem Statement

tally.chat only runs as a development setup today: install Bun, run a dev server that starts a local Convex backend, answer its prompts, then set a master key by hand from a second terminal. That's fine for me and for contributors, but it isn't how anyone runs an app they rely on. There's no production build, nothing restarts it after a reboot, the generated secrets live wherever the dev tools put them, and there's no written path for backups, upgrades, reaching local models or putting it behind HTTPS. The design doc is blunt about why this matters before announcing the project: open-source chat apps win or lose adoption on install friction.

## Solution

One command brings up a production tally.chat with Docker Compose: a pinned Convex backend, the web app built for production, and a one-shot setup step that generates every secret on first run (the Convex admin key, the master key that encrypts provider keys, the auth signing keys), pushes the backend functions, and is safe to run again on every upgrade. Data and secrets live in named volumes and one generated file I'm told to back up. A self-hosting guide walks through install, reaching Ollama and other private hosts, HTTPS behind a reverse proxy, ports, backups and restores, and upgrades. A smoke check proves a fresh stack works end to end, and the README's quick start becomes the Docker path.

## User Stories

### Install

1. As a self-hoster, I want one command that brings up the whole app, so that installing takes minutes, not an afternoon.
2. As a self-hoster, I want the only prerequisite to be Docker with Compose, so that I don't install Bun, Node or Convex tooling on my server.
3. As a self-hoster, I want every secret generated for me on first run, so that I never invent or paste cryptographic keys.
4. As a self-hoster, I want the generated secrets written to one file I'm told to back up, so that I know exactly what losing it would cost.
5. As a self-hoster, I want the first visit to show the set-password page, so that I can claim the instance before anyone else.
6. As a self-hoster, I want the backend, its version and the app's version pinned, so that my install behaves like everyone else's.
7. As a self-hoster, I want the stack to restart itself after a reboot or a crash, so that it keeps running unattended.
8. As a self-hoster, I want ports bound to localhost by default, so that nothing is exposed to my network until I choose to.
9. As a self-hoster, I want to change the ports with environment variables, so that tally.chat fits beside other services.
10. As a self-hoster, I want the Convex dashboard off by default and available on request, so that I only run what I need.

### Running

11. As a self-hoster, I want provider calls, streaming, keepalives, titles and scheduled jobs to work exactly as in development, so that the packaged app isn't a lesser version.
12. As a self-hoster, I want long replies not to hit an action time limit, so that long-mode answers finish.
13. As a self-hoster, I want a health check per service, so that `docker compose ps` tells me whether it's working.
14. As a self-hoster, I want logs from each service through `docker compose logs`, so that I can see what went wrong.

### Reaching models and the outside world

15. As a self-hoster, I want a documented way to reach Ollama or LM Studio on the same machine, so that local models work from inside Docker.
16. As a self-hoster, I want a documented way to reach a model server elsewhere on my network, so that a GPU box down the hall works.
17. As a self-hoster, I want a documented way to put tally.chat behind HTTPS with a reverse proxy, so that I can use it from my phone safely.
18. As a self-hoster, I want the public URLs to be settings, not rebuilt code, where possible, so that moving to a domain is a config change.

### Data

19. As a self-hoster, I want my data on a named volume that survives `docker compose down`, so that stopping the app never loses threads.
20. As a self-hoster, I want a backup command and a restore command, so that I can recover from a dead disk.
21. As a self-hoster, I want the guide to tell me to back up the secrets file alongside the data, so that restored provider keys are still readable.
22. As a self-hoster, I want upgrading to be pull, rebuild, start, so that I keep up with releases without reading a migration guide each time.
23. As a self-hoster, I want an upgrade to keep my threads, providers, spend history and settings, so that upgrades are safe.

### Trust

24. As a self-hoster, I want a smoke check I can run after install or upgrade, so that I know the stack works before I rely on it.
25. As a contributor, I want the same smoke check to run against a fresh stack, so that packaging regressions are caught.
26. As a reader of the README, I want the quick start to be the Docker path, so that the first thing I try is the supported one.

## Implementation Decisions

### Services (Docker Compose)

- **backend**: the Convex backend image pinned to a specific revision (never `:latest`, per the spike), on a named volume (SQLite, the default), with `restart: unless-stopped` and a health check on its HTTP endpoint. `V8_ACTION_USER_TIMEOUT_SECS` is raised so long-mode replies and keepalive chains don't hit the action limit. Provider calls run in Convex's Node runtime (the URL guard needs DNS), so the pinned image must run Node actions; the first ticket proves it.
- **setup** (one-shot): runs on every `up`, before the web app. On first run it generates the Convex admin key, `TALLY_MASTER_KEY`, and Convex Auth's `JWT_PRIVATE_KEY` and `JWKS`, writing them to a secrets file in a mounted directory; on later runs it reuses that file. It then deploys the Convex functions to the backend and sets the deployment's environment (`TALLY_MASTER_KEY`, the auth keys, `SITE_URL`). It exits when done; the web service depends on its success. Re-running it is the upgrade path.
- **web**: the Next.js app built for production (standalone output) on a slim Bun-based image, depending on the backend being healthy and setup having succeeded, with `restart: unless-stopped` and a health check.
- **dashboard** (optional): the pinned Convex dashboard behind a Compose profile, off unless asked for.
- All published ports bind to `127.0.0.1` by default; `TALLY_PORT`, `CONVEX_PORT` and `CONVEX_SITE_PORT` (and a bind-address variable) change them.

### URLs and the browser

- The browser talks to Convex directly, so it needs the backend's public URL. Next.js bakes public variables into the build, so the web image is built by Compose from the local checkout with the public Convex URL as a build argument. Changing the public URL means rebuilding the web image; the guide says so. (A runtime-config injection would avoid the rebuild; deferred, see Out of Scope.)
- `SITE_URL` (the app's public URL) and the Convex site URL are set on the deployment by setup from the same variables, so the auth flow uses the public addresses.

### Secrets

- One generated secrets file (Compose `.env`-style) in a directory mounted into setup; the guide marks it, and the data volume, as the two things to back up. Losing `TALLY_MASTER_KEY` makes stored provider keys unreadable; losing the admin key only means generating a new one.
- Secrets are never baked into images or printed in logs.

### Backups, restore and upgrades

- Backup and restore use Convex's export and import against the running backend, wrapped in two documented commands that run inside a container (no host tooling). A backup is a dated archive plus a copy of the secrets file.
- Upgrade: `git pull`, `docker compose build`, `docker compose up -d`. Setup re-deploys the functions; schema changes stay backwards-compatible (every field added so far is optional), so existing data needs no migration step. A release that needs one documents it in its notes.

### Smoke check

- A script that drives a running stack the way a person would: the app answers, the set-password page appears on a fresh install, an account can be created, a provider can be added against a bundled fake OpenAI-compatible server (a tiny container under a test profile), a message streams a reply, and usage is recorded. It runs against a throwaway Compose project so it never touches real data.

### Guide and README

- `docs/self-hosting.md`: prerequisites, install, first run, what to back up, ports and bind address, reaching private hosts (`host.docker.internal` for the same machine, a LAN address for another, both added to tally.chat's allowlist), HTTPS with a reverse proxy (a Caddy example), public URLs and the rebuild they need, backups and restore, upgrades, logs and the smoke check, and the DNS-rebinding note from the self-hosting notes.
- The README's quick start becomes the Docker path; the development setup moves to the Development section.

## Testing Decisions

- This phase is packaging, so its tests are end to end against a running stack, not `convex-test`. **One new seam:** the smoke check, driving the stack over HTTP and the browser the way a self-hoster would, against a fake model server on the stack's own network. The existing 190 tests keep covering behaviour and still run in development.
- **Must-have checks**
  - A fresh `up` reaches a healthy state with no manual step, and the first visit shows the set-password page.
  - Signup, adding a provider (the fake server), sending a message, a streamed reply and recorded usage all work on the packaged stack, which proves Node actions, the URL guard, streaming and Convex Auth on the Docker backend (the spike didn't cover auth or Node actions).
  - A second `up` reuses the secrets (existing provider keys still decrypt) and re-deploys without losing data.
  - Backup then restore into a fresh stack brings back threads and providers, and provider keys decrypt with the restored secrets file.
  - `docker compose down` then `up` keeps all data.
- **Prior art:** the [self-host spike](../spike-convex-self-host.md) (its setup steps and findings), and the browser checks used in phases 2 to 4.

## Out of Scope

- A hosted public instance, multi-user accounts and sign-up (design doc section 11)
- Postgres or MySQL instead of SQLite (the spike covered SQLite only)
- Runtime injection of the public Convex URL (avoiding the rebuild when it changes)
- Prebuilt images published to a registry; self-hosters build the web image from the checkout
- Kubernetes, Helm or one-click platform templates
- Automatic HTTPS inside the stack (the guide shows a reverse proxy instead)
- Closing the DNS-rebinding window in the URL guard (documented, not fixed)

## Further Notes

- Every secret and data path is a deliberate, documented location, because the failure that hurts most here is a restore that brings back threads but not the master key.
- Pinning the backend means upgrades of Convex itself are deliberate: bump the pinned revision in a release after the smoke check passes against it.
