#!/bin/sh
# Restores a backup made by selfhost/backup.sh, replacing all data in this instance:
#   selfhost/restore.sh backups/tally-<date> [--replace-secrets]
# Works on a fresh checkout (nothing set up yet) or an existing stack. If this instance already
# has different secrets, it stops unless --replace-secrets is given.
set -eu
[ $# -ge 1 ] || { echo "usage: selfhost/restore.sh <backup dir> [--replace-secrets]" >&2; exit 2; }
backup=$(cd "$1" && pwd)
cd "$(dirname "$0")/.."
docker compose up -d --wait backend
docker compose run --rm --no-deps -v "$backup:/backup:ro" setup bun selfhost/setup.ts restore /backup ${2:-}
# The backend keeps the previous environment in warm function runtimes; restart it so the
# restored master key is the one in use.
docker compose restart backend
docker compose up -d --wait
