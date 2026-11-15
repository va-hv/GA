#!/usr/bin/env bash
# Is this server ready for real use? (make prod-check). Read-only: it only looks and reports.
set -uo pipefail
cd "$(dirname "$0")/.."
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi
problems=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFIX\033[0m   %s\n' "$*"; problems=$((problems + 1)); }
warn() { printf '  \033[33mnote\033[0m  %s\n' "$*"; }

[ -f .env ] || { echo "No .env: run sudo bash ops/install.sh first."; exit 1; }
set -a; . ./.env; set +a

echo "Settings"
[ "${INSTANCE:-}" = production ] && ok "INSTANCE=production" || bad "INSTANCE is '${INSTANCE:-}', should be production"
[ "${COMPOSE_PROFILES:-}" = https ] && ok "HTTPS front door switched on" || bad "COMPOSE_PROFILES should be https"
[ "${COOKIE_SECURE:-}" = true ] && ok "cookies only over HTTPS" || bad "COOKIE_SECURE should be true"
[ "${BEHIND_PROXY:-}" = true ] && ok "sign-in lockout per visitor address" || bad "BEHIND_PROXY should be true"
[ -n "${DOMAIN:-}" ] && [ "${DOMAIN}" != localhost ] && ok "address: ${DOMAIN}" || bad "DOMAIN is not set to the server's address"
for v in POSTGRES_PASSWORD APP_DB_PASSWORD BACKUP_KEY; do
  [ "${#v}" -gt 0 ] && [ "$(printenv "$v" | wc -c)" -gt 32 ] && ok "$v is set and long" || bad "$v is missing or short"
done
perm=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env)
[ "$perm" = 600 ] && ok ".env readable by its owner only" || bad ".env permissions are $perm (run: chmod 600 .env)"

echo "Running"
for s in db api web https; do
  state=$("${DC[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk -v s="$s" '$1 == s {print $2, $3}')
  case "$state" in
    "running healthy"|"running ") ok "$s is running${state#running}" ;;
    *) bad "$s is not running (${state:-missing})" ;;
  esac
done

echo "Data"
q() { "${DC[@]}" exec -T db sh -c "psql -X -tA -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$1\"" 2>/dev/null; }
sites=$(q "SELECT count(*) FROM base.orgs")
[ "${sites:-0}" -ge 1 ] && ok "$sites site(s)" || bad "no site yet: make site NAME='...' ADMIN=... ADMIN_NAME='...'"
demo=$(q "SELECT count(*) FROM base.accounts WHERE username LIKE 'demo-%' OR username LIKE 'e2e-%' OR username LIKE 't-%'")
[ "${demo:-0}" = 0 ] && ok "no demo or test accounts" || bad "$demo demo or test account(s) found: this database holds made-up data"
intact=$(q "SELECT coalesce(bool_and(base.history_intact(id)), true) FROM base.orgs")
[ "$intact" = t ] && ok "history intact at every site" || bad "history check failed"
twostep=$(q "SELECT count(*) FROM base.site_settings WHERE NOT require_two_step_admins")
[ "${twostep:-0}" = 0 ] && ok "two-step sign-in required for admins at every site" || warn "$twostep site(s) do not require two-step for admins"

echo "Backups"
crontab -l 2>/dev/null | grep -qF "ops/backup.sh" && ok "nightly backup scheduled" || bad "nightly backup not scheduled (make schedule shows the line)"
latest=$(ls -1t backups/gatehouse-*.dump.enc 2>/dev/null | head -1)
if [ -n "$latest" ]; then
  age=$(( ( $(date +%s) - $(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest") ) / 3600 ))
  [ "$age" -le 26 ] && ok "newest backup $latest ($age h old)" || bad "newest backup is $age hours old"
else
  bad "no backup yet: make backup && make restore-test"
fi

echo "From outside"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -k "https://${DOMAIN}/" || true)
[ "$code" = 200 ] && ok "https://${DOMAIN} answers" || bad "https://${DOMAIN} did not answer (got '${code}'): check DNS and ports 80/443"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${DOMAIN}/" || true)
case "$code" in 301|308) ok "plain http redirects to https" ;; *) warn "http://${DOMAIN} gave '${code}' (expected a redirect)" ;; esac

echo
if [ "$problems" = 0 ]; then echo "Ready."; else echo "$problems thing(s) to fix."; exit 1; fi
