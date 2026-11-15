#!/bin/sh
# Applies db/roles.sql, then every migration in db/migrations not applied yet, each in its own transaction.
# Runs in the `migrate` container (docker-compose.yml) as the bootstrap superuser. Never edit an applied migration:
# add the next number instead.
set -eu

export PGHOST="${PGHOST:-db}" PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -X -q -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -f /db/roles.sql

for f in /db/migrations/*.sql; do
  name=$(basename "$f")
  done_already=$(psql -X -tA -c "SELECT 1 FROM public.applied_migrations WHERE name = '$name'")
  if [ "$done_already" = "1" ]; then continue; fi
  echo "applying $name"
  psql -X -q -v ON_ERROR_STOP=1 -1 -f "$f" -c "RESET ROLE; INSERT INTO public.applied_migrations(name) VALUES ('$name')"
done
echo "database is up to date"
