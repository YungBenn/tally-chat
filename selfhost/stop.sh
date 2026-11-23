#!/bin/sh
# Stops what selfhost/start.sh started: the app on port 3000, then the backend and the
# dashboard. Next can hand the server to a detached child, so the app is stopped by its port
# as well as by its saved PID.
cd "$(dirname "$0")/.."
pid=$(cat .run/next.pid 2>/dev/null) && kill "$pid" 2>/dev/null
rm -f .run/next.pid
lsof -t -iTCP:3000 -sTCP:LISTEN | xargs kill 2>/dev/null
docker compose stop backend dashboard
echo "tally.chat stopped"
