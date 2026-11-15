-- Database roles. Run by db/migrate.sh as the bootstrap superuser before the migrations, every time (safe to repeat).
--
--   gatehouse_owner  owns every schema, table and function. Cannot sign in. Bypasses row-level security, so the
--                    rule functions (SECURITY DEFINER) always filter by the caller's organisation themselves.
--   gatehouse_app    what the API connects as. Not the owner, cannot bypass row-level security, cannot write any
--                    table directly: every change goes through a rule function.

SELECT 'CREATE ROLE gatehouse_owner NOLOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gatehouse_owner') \gexec

SELECT format('CREATE ROLE gatehouse_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gatehouse_app') \gexec

ALTER ROLE gatehouse_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';

SELECT format('GRANT CREATE, CONNECT ON DATABASE %I TO gatehouse_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO gatehouse_app', current_database()) \gexec
SELECT format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', current_database()) \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- pgcrypto: bcrypt password hashes (crypt, gen_salt) and random tokens (gen_random_bytes).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
