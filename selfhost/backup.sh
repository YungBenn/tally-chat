#!/bin/sh
# Backs up a running stack into <parent>/tally-<date>/ (default parent: backups/): data.zip
# (threads, providers, usage, settings, images) and tally.env (the secrets that decrypt
# provider keys). Needs only Docker.
#   selfhost/backup.sh [parent dir]
set -eu
parent=${1:-backups}
mkdir -p "$parent"
parent=$(cd "$parent" && pwd)
cd "$(dirname "$0")/.."
dir=$parent/tally-$(date +%Y%m%d-%H%M%S)
mkdir -p "$dir"
docker compose run --rm --no-deps -v "$dir:/backup" setup bun selfhost/setup.ts backup /backup
echo "Backup written to $dir"
