#!/bin/sh
# Backs up a running stack into backups/tally-<date>/: data.zip (threads, providers, usage,
# settings, images) and tally.env (the secrets that decrypt provider keys). Needs only Docker.
set -eu
cd "$(dirname "$0")/.."
dir=backups/tally-$(date +%Y%m%d-%H%M%S)
mkdir -p "$dir"
docker compose run --rm --no-deps -v "$PWD/$dir:/backup" setup bun selfhost/setup.ts backup /backup
echo "Backup written to $dir"
