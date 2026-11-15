#!/usr/bin/env bash
# Encrypted backup of the whole database into backups/ (make backup). Keeps the newest 14 good backups.
# Encrypted with BACKUP_KEY from .env (AES-256). Keep a copy of that key away from this server: without it, no backup
# can be read. Copy backups/ off the server too (the customer owns the off-site copies).
#
# A backup only counts once it is complete and readable: it is written to a temporary name, any failed
# step stops everything, the result is decrypted and its table of contents read back, and only then is it named and
# are the oldest backups pruned. A failed run never removes a good backup.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${BACKUP_KEY:?BACKUP_KEY is not set in .env (make setup adds one to a new .env)}"
export BACKUP_KEY
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi

mkdir -p backups && chmod 700 backups
umask 077
stamp=$(date +%Y%m%d-%H%M%S)
partial="backups/.partial-$stamp.dump.enc"
final="backups/gatehouse-$stamp.dump.enc"
cleanup() { [ -f "$partial" ] && rm -f -- "$partial"; return 0; }
trap cleanup EXIT

"${DC[@]}" exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -out "$partial"

# Read it back: it must decrypt and be a complete dump with the visits table in it.
entries=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$partial" \
  | "${DC[@]}" exec -T db pg_restore -l | grep -c "TABLE DATA gate visits" || true)
if [ "$entries" != "1" ]; then
  echo "backup FAILED: the file could not be read back as a complete database dump; older backups were kept"
  exit 1
fi
mv -- "$partial" "$final"

# keep the newest 14 good backups (only files named backups/gatehouse-*.dump.enc)
ls -1t backups/gatehouse-*.dump.enc | tail -n +15 | while read -r old; do
  case "$old" in backups/gatehouse-*.dump.enc) rm -f -- "$old" ;; esac
done
echo "saved $final ($(du -h "$final" | cut -f1)), checked readable"
