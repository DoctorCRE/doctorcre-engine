#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
container=$(docker run -d --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1::5432 postgres:18 -c max_locks_per_transaction=256)
trap 'docker stop "$container" >/dev/null' EXIT
until docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
{ printf 'create schema next; set search_path to next, public;\n'; cat schema/next.sql; } | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
image=ghcr.io/k1low/tbls:v1.97.0
dsn='postgres://postgres@localhost:5432/postgres?sslmode=disable&search_path=next'
docker run --rm --network "container:$container" -v "$PWD:/work" -w /work "$image" doc "$dsn" docs/database/tables -c docs/database/.tbls.yml --without-er --force --sort
sed -n 's/^  - id: //p' docs/database/.tbls.yml | while IFS= read -r area; do
  docker run --rm --network "container:$container" -v "$PWD:/work" -w /work "$image" out "$dsn" -c docs/database/.tbls.yml -t md --viewpoint "$area" --sort -o "docs/database/tables/viewpoint-$area.md"
done

./node_modules/.bin/biome format --write docs/database/tables
