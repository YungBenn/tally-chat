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

Web search runs on [Exa](https://exa.ai), a search API built for feeding models. There is nothing to host: create a key in [Exa's dashboard](https://dashboard.exa.ai/api-keys), then open Settings → **Web search** and paste it. The key is encrypted like a provider key and never sent back to the browser. Saving it doesn't run a search, so it costs nothing.

With a key saved, the composer gets a **Search** toggle: a message sent with it on is searched first, and the top results (titles, links and a short passage from each) go to the model with it. The sources show under your message.

Each search costs about a cent, billed by Exa to your account. tally.chat records the cost Exa reports: it shows on the sources line, adds to the thread's spend and the usage page, and counts toward your daily budget. A failed search costs nothing and shows Exa's reason, such as an invalid key or no credits left.

Exa sees every query you search, tied to your Exa account. Leave Search off for anything you don't want it to see.

## Tool servers

Tools let the model call outside services during a reply. tally.chat speaks to remote MCP servers over Streamable HTTP: open **Tools** in the sidebar, add the server's URL and any headers it needs (such as `Authorization: Bearer ...`, encrypted like provider keys), and tally.chat connects and lists what it offers.

A server on a private address (your LAN, another container) must be on the private host allowlist in Settings first, like a local model server.

### A local (stdio) server behind a proxy

Many MCP servers only speak stdio, meaning they run as a local process. tally.chat never launches processes, so wrap such a server in a small proxy container that exposes it over HTTP. This `docker-compose.override.yml` wraps the reference filesystem server with [supergateway](https://github.com/supercorp-ai/supergateway); swap the `--stdio` command for the server you want:

```yaml
services:
  mcp-files:
    image: node:22-alpine
    restart: unless-stopped
    command:
      - npx
      - -y
      - supergateway
      - --stdio
      - npx -y @modelcontextprotocol/server-filesystem /files
      - --outputTransport
      - streamableHttp
      - --port
      - "8000"
    volumes:
      - ./my-files:/files:ro
```

Run `docker compose up -d`, add `mcp-files:8000` to the private host allowlist in Settings, then add a tool server with the URL `http://mcp-files:8000/mcp`. The port isn't published, so only containers on the compose network can reach it; if you publish it, set an API key on the proxy and send it as a header.

A tool call runs whatever the server does with the access you gave it, so mount only what the model may read, read-only where you can. Each tool asks before it runs unless you mark it always allowed on the Tools page.

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

### Over Tailscale, tailnet only

If your devices are on a tailnet, Tailscale Serve gives the backend HTTPS on your machine's tailnet name without opening anything to the internet. Serve the two backend ports on their own HTTPS ports:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3210
tailscale serve --bg --https=8444 http://127.0.0.1:3211
```

```bash
# .env
TALLY_PUBLIC_URL=https://your-machine.your-tailnet.ts.net
CONVEX_PUBLIC_URL=https://your-machine.your-tailnet.ts.net:8443
CONVEX_SITE_PUBLIC_URL=https://your-machine.your-tailnet.ts.net:8444
```

Serve the app itself the same way (or on 443), then rebuild. `tailscale serve status` should list both backend ports as "tailnet only". A device without Tailscale running can load the sign-in page but can't reach the backend, so nothing after sign-in works there.

## Backups

```bash
./selfhost/backup.sh
```

This writes `backups/tally-<date>-<time>/` with two files, both readable only by their owner:

- `data.zip`: a Convex export of everything, images included
- `tally.env`: a copy of your secrets

The stack keeps running during a backup. Copy the backup directory somewhere off the machine; it contains your secrets, so treat it like a password. `./selfhost/backup.sh <dir>` writes the backup under another directory instead.

### Nightly backups

`selfhost/nightly-backup.sh` runs a backup into `~/tally-backups/nightly/`, keeps the last 14 days and deletes older ones (only after a successful run). Every run adds a line to `~/Library/Logs/tally-backup.log`. A failure adds a `FAILED` line with the error and, on macOS, shows a notification. Set `TALLY_BACKUP_DIR` or `TALLY_BACKUP_LOG` to use other paths.

On macOS, schedule it with launchd at 03:30 every night. If the Mac is asleep then, it runs on wake. Docker must be running. From the repository:

```bash
cat > ~/Library/LaunchAgents/chat.tally.backup.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>chat.tally.backup</string>
  <key>ProgramArguments</key><array><string>$PWD/selfhost/nightly-backup.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tally-backup.log</string>
</dict></plist>
PLIST
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/chat.tally.backup.plist
launchctl kickstart gui/$(id -u)/chat.tally.backup   # run once now to check
tail ~/Library/Logs/tally-backup.log
```

To stop it: `launchctl bootout gui/$(id -u)/chat.tally.backup`. On Linux, a cron entry does the same: `30 3 * * * /path/to/tally-chat/selfhost/nightly-backup.sh`.

**Where failures show up.** `~/Library/Logs/tally-backup.log` (also visible in Console.app under Log Reports): `ok` lines for good runs, `pruned` lines for deleted backups, and `FAILED` lines followed by the error. No new `ok` line for a day means the job isn't running; check `launchctl print gui/$(id -u)/chat.tally.backup`.

To restore one of them, pass its directory to `./selfhost/restore.sh` (next section).

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
