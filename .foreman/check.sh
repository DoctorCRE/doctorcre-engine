#!/usr/bin/env bash
# A script, because the factory's Claude grant matches one simple command, not a compound one.
set -euo pipefail
pg_ctlcluster 18 main status || pg_ctlcluster 18 main start
mkdir -p out
# NODE_OPTIONS reaches the node --test run inside scripts/database-check.ts, so JUnit needs no script change.
export NODE_OPTIONS='--test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=out/junit.xml'
exec npm run check
