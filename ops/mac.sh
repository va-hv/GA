#!/usr/bin/env bash
# Gatehouse on a Mac, to try it out or demo it:   bash ops/mac.sh
#
# What it does (safe to run again; it never deletes anything):
#   1. checks Docker is there and running (starts Docker Desktop or Colima if one is installed)
#   2. writes .env with random passwords if there is none
#   3. builds and starts Gatehouse on http://localhost:3600
#   4. if there is no site yet: loads a demo site with made-up data, or creates an empty site with your own admin
#   5. opens it in the browser
# For real use, put it on a server instead (README.md): this Mac copy has no HTTPS and stops when the Mac sleeps.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { local q=$1 d=${2:-}; local a; read -r -p "$q${d:+ [$d]}: " a; echo "${a:-$d}"; }
need() { printf '\n%s\n' "$*"; exit 1; }

[ "$(uname -s)" = Darwin ] || echo "Note: this script is meant for a Mac. On a server use ops/install.sh."

# 1. Tools ----------------------------------------------------------------------------------------------------------
say "1. Checking the tools"
command -v make >/dev/null 2>&1 || need "Apple's command line tools are missing. Run:  xcode-select --install   then run this again."
command -v openssl >/dev/null 2>&1 || need "openssl is missing (it normally comes with macOS)."
command -v docker >/dev/null 2>&1 || need "Docker is missing. Either:
  - install Docker Desktop from https://www.docker.com/products/docker-desktop/ and open it once, or
  - with Homebrew:  brew install colima docker docker-compose
then run this again."

if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    echo "Starting Colima (the Docker engine) with 2 CPUs and 4 GB of memory..."
    colima start --cpu 2 --memory 4
  elif [ -d /Applications/Docker.app ]; then
    echo "Starting Docker Desktop..."
    open -a Docker
  else
    need "Docker is installed but not running. Start Docker Desktop (or Colima) and run this again."
  fi
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || need "Docker did not start. Open Docker Desktop (or run: colima start) and try again."
fi
if docker compose version >/dev/null 2>&1; then DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then DC=(docker-compose)
else need "Docker Compose is missing. With Homebrew:  brew install docker-compose   (Docker Desktop includes it)."
fi
echo "Docker is running ($(docker --version | cut -d, -f1)); using: ${DC[*]}"

# 2. Settings -------------------------------------------------------------------------------------------------------
say "2. Settings"
make -s setup
grep -q '^INSTANCE=production' .env && need "This .env is set up as a production server (INSTANCE=production). Use a separate copy for trying it out on a Mac."
port=$(grep -s '^WEB_PORT=' .env | cut -d= -f2); port=${WEB_PORT:-${port:-3600}}

# 3. Build and start ----------------------------------------------------------------------------------------------
say "3. Building and starting (the first time takes a few minutes)"
"${DC[@]}" up -d --build
echo "Waiting for the app..."
for _ in $(seq 1 90); do curl -fs -o /dev/null "http://localhost:${port}/" && break; sleep 2; done
curl -fs -o /dev/null "http://localhost:${port}/" || need "The app did not answer on http://localhost:${port}. See:  make logs"

# 4. Something to sign in to ---------------------------------------------------------------------------------------
sites=$("${DC[@]}" exec -T db sh -c 'psql -X -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM base.orgs"')
if [ "${sites:-0}" -gt 0 ]; then
  say "4. Already set up ($sites site(s)): nothing to add"
else
  say "4. Something to sign in to"
  echo "  1) A demo site with made-up trucks and visitors, and one account per role (to look around)"
  echo "  2) An empty site with your own admin (needs an authenticator app for two-step sign-in)"
  choice=$(ask "Choose 1 or 2" "1")
  if [ "$choice" = 2 ]; then
    site=$(ask "Site name")
    admin=$(ask "Admin username (lower case)")
    admin_name=$(ask "Admin full name")
    make -s site NAME="$site" ADMIN="$admin" ADMIN_NAME="$admin_name"
  else
    make -s demo
    echo "Sign in as demo-security, demo-dock or demo-admin with the password above. Write it down: it is shown once."
  fi
fi

say "Gatehouse is running: http://localhost:${port}"
command -v open >/dev/null 2>&1 && open "http://localhost:${port}" || true
cat <<EOF

  Stop it:          make down            (your data is kept)
  Start it again:   make up              (Docker Desktop or Colima must be running)
  Reception kiosk:  sign in as admin > Admin > Kiosks > Add, then open http://localhost:${port}/kiosk
  On a phone or tablet on the same Wi-Fi: not from this Mac copy (it only answers on this Mac). Use a server (README.md).
EOF
