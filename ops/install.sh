#!/usr/bin/env bash
# Gatehouse installer for an Ubuntu server (22.04 or 24.04), on site or in Azure.
#
#   sudo bash ops/install.sh
#
# What it does, in order (it asks before anything that matters and can be run again safely):
#   1. installs Docker Engine from Docker's own package source, if Docker is not there yet
#   2. writes .env with random passwords, a backup key and your address, if there is no .env yet
#   3. builds and starts Gatehouse with the HTTPS front door
#   4. creates the first site and its admin (prints a temporary password once)
#   5. offers to add the nightly encrypted backup to the server's schedule
# It never changes the firewall, SSH or other services. Open ports 80 and 443 yourself (see README.md).
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR=$(pwd)

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask()  { local q=$1 d=${2:-}; local a; read -r -p "$q${d:+ [$d]}: " a; echo "${a:-$d}"; }
yes_no() { local a; read -r -p "$1 [y/N]: " a; [[ "$a" =~ ^[Yy] ]]; }

[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash ops/install.sh"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "This installer is for Ubuntu (found: ${PRETTY_NAME:-unknown})."; exit 1; }

# 1. Docker -------------------------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "1. Installing Docker Engine (from download.docker.com)"
  yes_no "Install Docker now?" || { echo "Docker is needed. Stopping."; exit 1; }
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg make openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  say "1. Docker is already installed: $(docker --version)"
  command -v make >/dev/null 2>&1 || apt-get install -y make
fi

# 2. Settings -----------------------------------------------------------------------------------------------------
if [ -f .env ]; then
  say "2. .env already exists: keeping it (passwords and backup key unchanged)"
else
  say "2. Settings"
  echo "The address people will type to reach Gatehouse, without https://"
  echo "  Azure: the VM's DNS name (e.g. gatehouse-pilot.canadacentral.cloudapp.azure.com) or your own name pointing at it"
  echo "  On site: the server's name or IP address on your network (e.g. gatehouse.local or 192.168.1.50)"
  domain=$(ask "Address")
  [ -n "$domain" ] || { echo "An address is needed."; exit 1; }
  echo
  echo "HTTPS certificate:"
  echo "  1) Let's Encrypt: free and automatic. Needs a public DNS name and ports 80 and 443 open to the internet (Azure)"
  echo "  2) Internal: for an on-site network. Each device trusts the certificate once (see README.md)"
  echo "  3) Your own certificate files in deploy/certs/cert.pem and deploy/certs/key.pem"
  choice=$(ask "Choose 1, 2 or 3" "1")
  case "$choice" in
    1) email=$(ask "Email for certificate notices (Let's Encrypt)"); [ -n "$email" ] || { echo "An email is needed."; exit 1; }; tls="$email" ;;
    2) tls="internal" ;;
    3) tls='"/certs/cert.pem /certs/key.pem"'
       [ -f deploy/certs/cert.pem ] && [ -f deploy/certs/key.pem ] || { echo "Put cert.pem and key.pem in deploy/certs/ first."; exit 1; } ;;
    *) echo "Choose 1, 2 or 3."; exit 1 ;;
  esac
  umask 077
  cp .env.example .env
  sed -i \
    -e "s|^INSTANCE=.*|INSTANCE=production|" \
    -e "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=https|" \
    -e "s|^DOMAIN=.*|DOMAIN=${domain}|" \
    -e "s|^TLS=.*|TLS=${tls}|" \
    -e "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" \
    -e "s|^BEHIND_PROXY=.*|BEHIND_PROXY=true|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^BACKUP_KEY=.*|BACKUP_KEY=$(openssl rand -hex 32)|" \
    .env
  chmod 600 .env
  echo "Wrote .env (readable by root only)."
  echo "IMPORTANT: copy the BACKUP_KEY line from .env somewhere safe away from this server (a password manager)."
  echo "Without it, no backup can ever be read."
fi

# 3. Build and start ----------------------------------------------------------------------------------------------
say "3. Building and starting Gatehouse (the first build takes a few minutes)"
docker compose up -d --build
echo "Waiting for the app to be ready..."
for i in $(seq 1 60); do
  docker compose ps --format '{{.Service}} {{.Health}}' | grep -q '^web healthy' && break
  sleep 5
done
docker compose ps

# 4. First site and admin -----------------------------------------------------------------------------------------
existing=$(docker compose exec -T db sh -c 'psql -X -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM base.orgs"')
if [ "${existing:-0}" -gt 0 ]; then
  say "4. A site already exists: skipping. (Add another with: make site NAME='...' ADMIN=... ADMIN_NAME='...')"
else
  say "4. The first site and its admin"
  site=$(ask "Site name (e.g. Northgate DC)")
  admin=$(ask "Admin username (lower case, e.g. jane.doe)")
  admin_name=$(ask "Admin full name")
  make site NAME="$site" ADMIN="$admin" ADMIN_NAME="$admin_name"
  echo "Give that password to the admin in person."
fi

# 5. Nightly backup -------------------------------------------------------------------------------------------------
line="30 2 * * * cd '$APP_DIR' && bash ops/backup.sh >> backups/backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "ops/backup.sh"; then
  say "5. The nightly backup is already scheduled"
elif yes_no "5. Add the nightly encrypted backup (02:30) to root's schedule?"; then
  (crontab -l 2>/dev/null || true; echo "$line") | crontab -
  echo "Scheduled. Check backups/backup.log the next morning."
fi

source_domain=$(grep '^DOMAIN=' .env | cut -d= -f2-)
say "Done. Open https://${source_domain}"
echo "Next: run  make prod-check  and fix anything it lists. Then  make backup && make restore-test  once."
