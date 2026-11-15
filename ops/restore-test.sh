#!/bin/sh
# Proves the newest backup can be restored (make restore-test): decrypts it into a throwaway database container,
# checks the history of every site and runs all the database rule tests against it, then removes the container.
# A real restore is the same steps into the real database; see README "Backups".
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${BACKUP_KEY:?BACKUP_KEY is not set in .env}"
export BACKUP_KEY
latest=$(ls -1t backups/gatehouse-*.dump.enc 2>/dev/null | head -1)
test -n "$latest" || { echo "no backup found: run make backup first"; exit 1; }
name="gatehouse-restore-test-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -e POSTGRES_USER=gatehouse -e POSTGRES_DB=gatehouse \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" -v "$PWD/db:/db:ro" postgres:16-alpine >/dev/null
i=0
until docker exec "$name" pg_isready -h 127.0.0.1 -U gatehouse -d gatehouse >/dev/null 2>&1; do
  i=$((i+1)); [ $i -lt 60 ] || { echo "test database did not start"; exit 1; }; sleep 1
done
sleep 2

# 1. the roles (they live outside the dump), 2. the dump itself
docker exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U gatehouse -d gatehouse \
  -c "CREATE ROLE gatehouse_owner NOLOGIN BYPASSRLS" -c "CREATE ROLE gatehouse_app LOGIN NOBYPASSRLS"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$latest" \
  | docker exec -i "$name" pg_restore --exit-on-error -U gatehouse -d gatehouse

echo "restored $latest into a test database"
docker exec "$name" psql -X -tA -U gatehouse -d gatehouse -c \
  "SELECT count(*) || ' sites, ' || (SELECT count(*) FROM gate.visits) || ' visits, history intact at every site: ' || coalesce(bool_and(base.history_intact(id)), true) FROM base.orgs"
docker exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U gatehouse -d gatehouse -f /db/tests/rules.sql | tail -1
