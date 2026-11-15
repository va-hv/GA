# Gatehouse. Run `make help` for the list.
SHELL := /bin/bash
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)
PSQL := $(COMPOSE) exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" "$$@"' psql
INSTANCE := $(shell grep -s '^INSTANCE=' .env | cut -d= -f2)
NOT_ON_PRODUCTION = @if [ "$(INSTANCE)" = production ]; then echo "Refused: this is a production install (INSTANCE=production in .env)."; exit 1; fi

.PHONY: help setup up down restart migrate test e2e site demo status logs backup restore-test schedule prod-check update psql sql

# The database prompt, and one query at a time (see README "The database"). Full access: read, don't change.
psql:
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

sql:
	@test -n "$(Q)" || { echo "usage: make sql Q=\"SELECT ...\"   (add CSV=1 for comma-separated output)"; exit 1; }
	@$(COMPOSE) exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" $(if $(CSV),--csv) -c "$$1"' sh "$(Q)"

help:
	@echo "make psql        the database prompt (read only, please)"
	@echo "make sql Q=\"...\" one database query (CSV=1 for a spreadsheet-ready answer)"
	@echo "On a server:  sudo bash ops/install.sh   (first time; see README.md)"
	@echo "make prod-check  is the server ready? (settings, health, backups, HTTPS)"
	@echo "make update      after copying in a new version: backup, rebuild, migrate, restart"
	@echo "make setup      create .env with random database passwords (laptop, once)"
	@echo "make up         build and start everything (laptop: http://localhost:3600)"
	@echo "make down       stop everything (data is kept)"
	@echo "make test       database rule tests"
	@echo "make e2e        API end-to-end tests (needs make up)"
	@echo "make site NAME='Northgate DC' ADMIN=jane ADMIN_NAME='Jane Doe'   a new site and its first admin"
	@echo "make demo       a demo site with made-up visits and one account per role"
	@echo "make status     what is running"
	@echo "make backup        encrypted database backup into backups/ (keeps the newest 14)"
	@echo "make restore-test  restore the newest backup into a throwaway database and test it"
	@echo "make schedule      the line that runs the backup every night (for the server's crontab)"

setup:
	@if [ -f .env ]; then echo ".env already exists: left as it is"; else \
	  cp .env.example .env && \
	  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$(openssl rand -hex 24)/; s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$$(openssl rand -hex 24)/; s/^BACKUP_KEY=.*/BACKUP_KEY=$$(openssl rand -hex 32)/" .env && \
	  rm -f .env.bak && echo ".env created with random passwords"; fi

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart api web

migrate:
	$(COMPOSE) up -d db
	$(COMPOSE) run --rm migrate

test:
	@$(PSQL) -f /db/tests/rules.sql

e2e:
	$(NOT_ON_PRODUCTION)
	@node api/test/e2e.mjs

prod-check:
	@bash ops/prod-check.sh

update:
	@bash ops/backup.sh
	$(COMPOSE) up -d --build
	@$(COMPOSE) ps

# A new site with its first admin. The temporary password is printed once; they change it at first sign-in.
site:
	@test -n "$(NAME)" -a -n "$(ADMIN)" -a -n "$(ADMIN_NAME)" || { echo "usage: make site NAME='Site name' ADMIN=username ADMIN_NAME='Full Name'"; exit 1; }
	@pw="$$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 14)7a"; \
	 echo "SELECT base.create_site(:'name', :'admin', :'admin_name', :'pw');" | \
	 $(PSQL) -v name="$(NAME)" -v admin="$(ADMIN)" -v admin_name="$(ADMIN_NAME)" -v pw="$$pw" >/dev/null && \
	 echo "Site '$(NAME)' created. Admin: $(ADMIN)   temporary password: $$pw" && \
	 echo "They sign in at /sign-in/admin, choose their own password and set up two-step sign-in (an authenticator app)."

demo:
	$(NOT_ON_PRODUCTION)
	@pw="$$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 14)7a"; \
	 $(PSQL) -v pw="$$pw" -f /db/demo.sql && \
	 echo "Demo site loaded. Accounts demo-admin, demo-security, demo-dock; password for all three: $$pw" && \
	 echo "Pair a kiosk from Team > Kiosks after signing in as demo-admin."

status:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --tail=100 -f api web

backup:
	@bash ops/backup.sh

restore-test:
	@sh ops/restore-test.sh

schedule:
	@echo "Add this line with 'crontab -e' on the server to back up every night at 02:30:"
	@echo "30 2 * * * cd '$(CURDIR)' && bash ops/backup.sh >> backups/backup.log 2>&1"
