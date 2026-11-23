#!/bin/sh
# Runs tally.chat with the app outside Docker: the Convex backend and the Convex dashboard
# in Docker, then the app (a `next build` made with the same public URLs) with `next start`
# on port 3000. Public URLs come from .env, else the compose defaults.
# Docker must be running. Stop everything with selfhost/stop.sh.
set -e
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
: "${CONVEX_PUBLIC_URL:=http://127.0.0.1:3210}" "${CONVEX_SITE_PUBLIC_URL:=http://127.0.0.1:3211}"
docker compose up -d --wait --remove-orphans backend dashboard
mkdir -p .run
CONVEX_URL_INTERNAL=http://127.0.0.1:3210 \
NEXT_PUBLIC_CONVEX_URL=$CONVEX_PUBLIC_URL NEXT_PUBLIC_CONVEX_SITE_URL=$CONVEX_SITE_PUBLIC_URL \
  nohup node_modules/.bin/next start -p 3000 > .run/next.log 2>&1 &
echo $! > .run/next.pid
echo "tally.chat starting at ${TALLY_PUBLIC_URL:-http://127.0.0.1:3000} (log: .run/next.log)"
echo "Convex dashboard at http://127.0.0.1:6791 (admin key: docker compose exec backend ./generate_admin_key.sh)"
