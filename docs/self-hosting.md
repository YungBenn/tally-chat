# Self-hosting tally.chat

tally.chat runs as a small Docker Compose stack on your own machine or server: a Convex backend (database, functions, scheduling), the web app, and a one-shot setup step that creates every secret for you. It's single-user: the first person to open it sets the password.

## Prerequisites

- Docker with Docker Compose 2.24.4 or later (`docker compose version`). Docker Desktop, OrbStack and Docker Engine on Linux all work.
- Git.
- About 2 GB of disk for the images. The first build takes a few minutes.

You don't need Bun, Node or any Convex tooling on the host.

## Install

```bash
git clone https://github.com/YungBenn/tally-chat.git
cd tally-chat
docker compose up -d
```

`docker compose up -d` builds the web image, starts the backend, then runs `setup`. On the first run, setup generates the master key that encrypts your provider keys and the auth signing keys, deploys the functions to the backend, and exits. The web app starts once setup succeeds.

Open http://127.0.0.1:3000 and set your password. Then add a provider on the **Providers** page and start a thread.

`docker compose ps` shows the state of each service. `backend` and `web` should be `healthy`; `setup` shows as exited, and that's expected.

## What to back up

Two things hold everything:

| What | Where | If you lose it |
|---|---|---|
| Your data: threads, providers, usage history, settings, images | the `tally_data` Docker volume | Gone, unless you have a backup |
| Your secrets | `selfhost/secrets/` in the checkout | Stored provider keys can't be decrypted: you'd have to enter every key again. You'd also be signed out. |

`selfhost/secrets/tally.env` holds `TALLY_MASTER_KEY`, the key every stored provider key is encrypted with. `selfhost/secrets/convex/` holds the backend's instance secret, which only grants admin access and is recreated if missing.

The backup command below saves both. See [Backups](#backups).

## Configuration

Settings live in a `.env` file next to `docker-compose.yml` (Compose reads it automatically; it's gitignored). Every setting is optional:

```bash
# .env
TALLY_BIND=127.0.0.1                         # address the ports are published on
TALLY_PORT=3000                              # port for the web app
TALLY_PUBLIC_URL=http://127.0.0.1:3000       # where you open tally.chat
CONVEX_PUBLIC_URL=http://127.0.0.1:3210      # where your browser reaches the backend
CONVEX_SITE_PUBLIC_URL=http://127.0.0.1:3211 # the backend's HTTP actions (sign-in uses it)
```

**Ports.** By default nothing is reachable from your network: all ports are published on `127.0.0.1`. The web app uses `TALLY_PORT`. The backend always publishes `3210` and `3211` on the bind address: the backend checks sign-in tokens by fetching from its own site URL, so those two ports stay fixed. Pick other ports with a reverse proxy (see [HTTPS](#https-behind-a-reverse-proxy)).

**Public URLs need a rebuild.** Your browser talks to the backend directly, and the web app has the backend's URL built in. After changing `CONVEX_PUBLIC_URL` or `CONVEX_SITE_PUBLIC_URL`, rebuild:

```bash
docker compose up -d --build
```

Changing `TALLY_PUBLIC_URL` alone takes effect on the next `docker compose up -d`, because setup applies it.

## Reaching local models

Provider calls are made from inside the backend container, and tally.chat's URL guard refuses private and `http` addresses until you allow them. To use a model server on your own machine or network, you do two things: add its host to the allowlist, then add it as a provider.

### Ollama or LM Studio on the same machine

From inside Docker, your machine is `host.docker.internal`.

1. **Settings → Private host allowlist**, add `host.docker.internal:11434` (Ollama) or `host.docker.internal:1234` (LM Studio).
2. **Providers → Add a provider**:
   - API style: **OpenAI-compatible**
   - Base URL: `http://host.docker.internal:11434/v1` (LM Studio: `http://host.docker.internal:1234/v1`)
   - API key: leave empty
   - Tick **Free provider (local models)** so replies are recorded as $0.

The model list comes from the server. Pick a model when you start a thread.

On Linux, Ollama and LM Studio listen on `127.0.0.1` by default, and containers can't reach that. Make Ollama listen on all interfaces (`OLLAMA_HOST=0.0.0.0`; for the systemd service, `sudo systemctl edit ollama` and add `Environment="OLLAMA_HOST=0.0.0.0"`), or turn on **Serve on Local Network** in LM Studio. On macOS and Windows no change is needed.

### A model server elsewhere on your network

Use the machine's LAN address in both places, for example allowlist `192.168.1.20:11434` and use the base URL `http://192.168.1.20:11434/v1`. Make sure the server listens on its LAN interface, not only on localhost.

## Web search

Web search runs on SearXNG, a private metasearch engine that needs no API key. tally.chat ships one as an optional service:

```bash
docker compose --profile search up -d
```

Then open Settings and set **Web search** to `http://searxng:8080`. The composer gets a **Search** toggle: a message sent with it on is searched first, and the top results (titles, links and short snippets) go to the model with it. The sources show under your message.

SearXNG asks other search engines on your behalf, so they still see your queries, though not who sent them. Engines such as Google sometimes block it for a while; a search then returns fewer or no results.

Already run SearXNG? Point the setting at it instead. Its `settings.yml` must list `json` under `search.formats`, or every search fails with HTTP 403. Naming the URL in Settings trusts its host, so it doesn't need a private host allowlist entry.

## HTTPS behind a reverse proxy

To use tally.chat from your phone or another machine, put it behind HTTPS. It needs three hostnames: one for the app and two for the backend (its API and its HTTP actions). This example uses Caddy on the same server, which gets certificates from Let's Encrypt automatically:

```caddyfile
# /etc/caddy/Caddyfile
chat.example.com {
	reverse_proxy 127.0.0.1:3000
}
convex.chat.example.com {
	reverse_proxy 127.0.0.1:3210
}
site.chat.example.com {
	reverse_proxy 127.0.0.1:3211
}
```

Point all three DNS names at the server, then set the public URLs and rebuild:

```bash
# .env
TALLY_PUBLIC_URL=https://chat.example.com
CONVEX_PUBLIC_URL=https://convex.chat.example.com
CONVEX_SITE_PUBLIC_URL=https://site.chat.example.com
```

```bash
docker compose up -d --build
```

Keep `TALLY_BIND=127.0.0.1`: Caddy reaches the stack on localhost, and the stack stays unreachable except through Caddy.

**The backend must reach its own public URLs.** It checks sign-in tokens against `CONVEX_SITE_PUBLIC_URL`, and its actions call back through `CONVEX_PUBLIC_URL`. So the hostnames have to resolve from the server itself, and the certificates have to be publicly trusted. With public DNS and Let's Encrypt, as above, that's already the case. A private CA or split-horizon DNS needs extra setup.

## Backups

```bash
./selfhost/backup.sh
```

This writes `backups/tally-<date>-<time>/` with two files, both readable only by their owner:

- `data.zip`: a Convex export of everything, images included
- `tally.env`: a copy of your secrets

The stack keeps running during a backup. Copy the backup directory somewhere off the machine; it contains your secrets, so treat it like a password. To back up nightly, add a cron entry such as:

```cron
0 3 * * * cd /path/to/tally-chat && ./selfhost/backup.sh >> backups/backup.log 2>&1
```

## Restore

On a fresh machine, clone the repository, copy your backup directory into it, and run:

```bash
./selfhost/restore.sh backups/tally-20261115-140005
```

The script starts the backend, puts the backup's secrets in place, deploys the functions, imports the data (replacing anything there), restarts the backend so it uses the restored keys, and starts the web app. Sign in with the password you had when the backup was made.

Restoring over an install that already has its own secrets (for example, you ran `docker compose up -d` first) stops with an explanation, because those secrets can't decrypt the backup's provider keys. To replace that install with the backup, data and secrets together:

```bash
./selfhost/restore.sh backups/tally-20261115-140005 --replace-secrets
```

If data ever ends up with the wrong master key anyway, replies say "This provider's key can't be decrypted". Restore the matching secrets file, or enter the key again on the **Providers** page.

## Upgrades

```bash
./selfhost/backup.sh          # optional, recommended
git pull
docker compose up -d --build
```

Setup runs on every `up` and re-deploys the functions, so an upgrade needs no extra step. Your threads, providers, settings and spend history are kept. A release that needs anything more says so in its notes.

The Convex backend image is pinned to a specific version in `docker-compose.yml`, so it only changes when a release bumps it.

## Logs and health

```bash
docker compose ps                  # health of each service
docker compose logs -f web backend # follow the logs
docker compose logs setup          # what the last setup run did
```

Setup never prints secrets.

For function-level logs and a look at your data, start the Convex dashboard. It's off by default:

```bash
docker compose --profile dashboard up -d
docker compose exec backend ./generate_admin_key.sh
```

Open http://127.0.0.1:6791 and paste the admin key. Stop it again with `docker compose --profile dashboard rm -sf dashboard`.

## Smoke check

```bash
./selfhost/smoke.sh
```

This brings up a throwaway copy of the stack under its own Compose project, with its own volumes and secrets and a fake model server. It then sets a password, adds the fake provider, sends a message, checks that the reply streams in and its cost is recorded, and removes everything. It never touches your data and can run while your instance is up. It takes under a minute once the images are built, prints `ok` for each step, and exits non-zero at the first step that fails.

Run it after installing or upgrading.

## Security notes

- **Single user.** Once the password is set, nobody else can create an account.
- **Keys stay on your server.** Provider keys are encrypted with `TALLY_MASTER_KEY` before they're stored, and are never sent to the browser.
- **The URL guard** refuses provider URLs that point at private, loopback or link-local addresses, and plain `http`, unless the host is on your allowlist. Only allowlist hosts you control.
- **DNS rebinding.** The guard resolves a hostname and checks every address, but the request resolves it again. A DNS server that answers differently the second time could slip a private address through. Allowlisting is your explicit choice, so the practical risk is a malicious public hostname. Pinning the connection to the checked address would close this gap; it isn't done yet.
- **Exposure.** Keep `TALLY_BIND=127.0.0.1` and publish through HTTPS as shown above. Binding to `0.0.0.0` serves plain HTTP to your whole network.

## Uninstall

```bash
docker compose down -v   # removes the containers AND your data volume
```

`docker compose down` without `-v` stops everything and keeps your data. Delete `selfhost/secrets/` to remove the secrets.
