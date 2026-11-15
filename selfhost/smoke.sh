#!/bin/sh
# Smoke check: brings up a throwaway copy of the stack (its own project, volumes and secrets),
# runs selfhost/smoke/check.ts against it, then removes it. Needs only Docker.
set -eu
cd "$(dirname "$0")/.."
compose() { docker compose -p tally-smoke -f docker-compose.yml -f selfhost/smoke/compose.yml --profile smoke "$@"; }
trap 'compose down -v --remove-orphans >/dev/null 2>&1' EXIT
compose build --quiet
compose run --rm check
