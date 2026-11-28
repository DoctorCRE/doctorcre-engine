#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
container=$(docker run -d --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1::5432 postgres:18 -c max_locks_per_transaction=256)
trap 'docker stop "$container" >/dev/null' EXIT
until docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
{ printf 'create schema next; set search_path to next, public;\n'; cat schema/next.sql; } | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
python3 docs/database/draw.py "$container"
