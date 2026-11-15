-- 001: sites (organisations), staff accounts, kiosks, sessions, sign-in lockout and the tamper-evident history.
--
-- How a request is identified: the API opens a transaction and puts the caller's session token in the setting
-- `gatehouse.token`. base.caller() looks the token up (hashed) in base.sessions. Nothing else identifies the caller:
-- without a valid, unexpired session for an active account or kiosk, every policy sees no organisation and every
-- rule function refuses. The API cannot pick an organisation by itself.
--
-- Error codes raised by rule functions (the API turns them into HTTP status codes):
--   GH400 bad input (DETAIL = the field), GH401 not signed in, GH403 wrong role, GH404 not found,
--   GH409 conflicts with a rule, GH428 must change password first.

SET LOCAL ROLE gatehouse_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE gatehouse_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE SCHEMA base;
GRANT USAGE ON SCHEMA base TO gatehouse_app;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

CREATE TABLE base.orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE base.accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES base.orgs(id),
  username             text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  full_name            text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 100),
  role                 text NOT NULL CHECK (role IN ('admin', 'security', 'dock')),
  password_hash        text NOT NULL CHECK (password_hash LIKE '$2%'),
  active               boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at      timestamptz
);
CREATE INDEX ON base.accounts (org_id);

CREATE TABLE base.kiosks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES base.orgs(id),
  label              text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  pairing_code_hash  bytea UNIQUE,
  pairing_expires_at timestamptz,
  paired_at          timestamptz,
  retired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((pairing_code_hash IS NULL) = (pairing_expires_at IS NULL))
);
CREATE UNIQUE INDEX kiosks_label_unique ON base.kiosks (org_id, lower(label)) WHERE retired_at IS NULL;

CREATE TABLE base.sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  org_id     uuid NOT NULL REFERENCES base.orgs(id),
  account_id uuid REFERENCES base.accounts(id),
  kiosk_id   uuid REFERENCES base.kiosks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz,
  CHECK ((account_id IS NULL) <> (kiosk_id IS NULL))
);
CREATE INDEX ON base.sessions (account_id) WHERE ended_at IS NULL;
CREATE INDEX ON base.sessions (kiosk_id) WHERE ended_at IS NULL;

-- Failed sign-ins per username and address. Five in a row lock that pair for five minutes.
CREATE TABLE base.sign_in_failures (
  username     text NOT NULL,
  ip           text NOT NULL,
  failures     int NOT NULL,
  locked_until timestamptz,
  PRIMARY KEY (username, ip)
);

-- Everything that changes something is written here. Append-only; each row carries a hash of the previous row of
-- the same organisation, so a removed or edited row breaks the chain (base.history_intact()).
CREATE TABLE base.history (
  seq       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id    uuid NOT NULL REFERENCES base.orgs(id),
  at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor     text NOT NULL,
  actor_id  uuid,
  action    text NOT NULL,
  subject   uuid,
  detail    jsonb NOT NULL DEFAULT '{}',
  prev_hash bytea,
  hash      bytea NOT NULL
);
CREATE INDEX ON base.history (org_id, seq DESC);
CREATE INDEX ON base.history (subject);

CREATE FUNCTION base.history_row_hash(h base.history) RETURNS bytea
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT sha256(coalesce(h.prev_hash, '\x'::bytea) || convert_to(concat_ws('|',
    h.org_id, h.at, h.actor, h.actor_id, h.action, h.subject, h.detail::text), 'UTF8'))
$$;

CREATE FUNCTION base.history_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text, 7));
  SELECT h.hash INTO NEW.prev_hash FROM base.history h WHERE h.org_id = NEW.org_id ORDER BY h.seq DESC LIMIT 1;
  NEW.hash := base.history_row_hash(NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER history_chain BEFORE INSERT ON base.history FOR EACH ROW EXECUTE FUNCTION base.history_chain();

CREATE FUNCTION base.refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: these records cannot be changed or removed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'GH409';
END $$;
CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON base.history
  FOR EACH ROW EXECUTE FUNCTION base.refuse_change();
CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON base.history
  FOR EACH STATEMENT EXECUTE FUNCTION base.refuse_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION base.token_hash(p_token text) RETURNS bytea
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT sha256(convert_to(p_token, 'UTF8')) $$;

CREATE FUNCTION base.new_token() RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_')
$$;

CREATE TYPE base.caller AS (
  session_id  uuid,
  org_id      uuid,
  account_id  uuid,
  kiosk_id    uuid,
  role        text,     -- admin | security | dock | kiosk
  name        text,
  must_change boolean
);

CREATE FUNCTION base.caller() RETURNS base.caller
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
  SELECT s.id, s.org_id, s.account_id, s.kiosk_id,
         CASE WHEN s.kiosk_id IS NOT NULL THEN 'kiosk' ELSE a.role END,
         coalesce(a.full_name, 'Kiosk: ' || k.label),
         coalesce(a.must_change_password, false)
    FROM base.sessions s
    LEFT JOIN base.accounts a ON a.id = s.account_id
    LEFT JOIN base.kiosks k   ON k.id = s.kiosk_id
   WHERE s.token_hash = base.token_hash(nullif(current_setting('gatehouse.token', true), ''))
     AND s.ended_at IS NULL
     AND s.expires_at > now()
     AND (a.id IS NULL OR a.active)
     AND (k.id IS NULL OR k.retired_at IS NULL)
$$;

CREATE FUNCTION base.org()  RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog, base AS $$ SELECT (base.caller()).org_id $$;
CREATE FUNCTION base.role() RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, base AS $$ SELECT (base.caller()).role $$;

-- Every rule function starts with this. Returns the caller, or refuses.
CREATE FUNCTION base.need(p_roles text[], p_allow_must_change boolean DEFAULT false) RETURNS base.caller
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.caller();
BEGIN
  IF c.session_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in' USING ERRCODE = 'GH401';
  END IF;
  IF c.must_change AND NOT p_allow_must_change THEN
    RAISE EXCEPTION 'You must change your password before continuing' USING ERRCODE = 'GH428';
  END IF;
  IF NOT (c.role = ANY (p_roles)) THEN
    RAISE EXCEPTION 'Your role cannot do this' USING ERRCODE = 'GH403';
  END IF;
  RETURN c;
END $$;

CREATE FUNCTION base.note(c base.caller, p_action text, p_subject uuid, p_detail jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql SET search_path = pg_catalog, base AS $$
  INSERT INTO base.history (org_id, actor, actor_id, action, subject, detail)
  VALUES (c.org_id, c.name, coalesce(c.account_id, c.kiosk_id), p_action, p_subject, coalesce(p_detail, '{}'))
$$;

-- Small helpers for rule functions that take a JSON body.
CREATE FUNCTION base.txt(p jsonb, k text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT nullif(btrim(p ->> k), '') $$;

CREATE FUNCTION base.bad(p_message text, p_field text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION '%', p_message USING ERRCODE = 'GH400', DETAIL = coalesce(p_field, ''); END $$;

CREATE FUNCTION base.req(p jsonb, k text, p_label text, p_max int DEFAULT 150) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
DECLARE v text := base.txt(p, k);
BEGIN
  IF v IS NULL THEN PERFORM base.bad(p_label || ' is required', k); END IF;
  IF length(v) > p_max THEN PERFORM base.bad(p_label || ' is too long', k); END IF;
  RETURN v;
END $$;

CREATE FUNCTION base.check_password(p_password text, p_field text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 10 THEN PERFORM base.bad('Password must be at least 10 characters', p_field); END IF;
  IF length(p_password) > 100 THEN PERFORM base.bad('Password is too long', p_field); END IF;
  IF p_password !~ '[A-Za-z]' THEN PERFORM base.bad('Password needs at least one letter', p_field); END IF;
  IF p_password !~ '[0-9]' THEN PERFORM base.bad('Password needs at least one number', p_field); END IF;
END $$;

CREATE FUNCTION base.hash_password(p_password text) RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$ SELECT crypt(p_password, gen_salt('bf', 10)) $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Signing in and out
-- ---------------------------------------------------------------------------------------------------------------

-- Never raises for a wrong password (that would roll back the failure count). Outcomes:
--   ok, bad (wrong name or password, or inactive), locked, wrong_page (right password, other role: `role` says which).
CREATE FUNCTION base.sign_in(p_username text, p_password text, p_page text, p_ip text, p_hours int DEFAULT 12)
RETURNS TABLE (outcome text, token text, role text, must_change boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
#variable_conflict use_column
DECLARE
  u  text := lower(btrim(coalesce(p_username, '')));
  v_ip text := left(coalesce(p_ip, ''), 64);
  a  base.accounts;
  f  base.sign_in_failures;
  ok boolean;
  t  text;
BEGIN
  SELECT * INTO f FROM base.sign_in_failures x WHERE x.username = u AND x.ip = v_ip;
  IF f.locked_until > now() THEN
    RETURN QUERY SELECT 'locked', NULL::text, NULL::text, NULL::boolean; RETURN;
  END IF;

  SELECT * INTO a FROM base.accounts x WHERE x.username = u;
  IF a.id IS NULL THEN
    PERFORM crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- same work as a real check: timing reveals nothing
    ok := false;
  ELSE
    ok := a.password_hash = crypt(coalesce(p_password, ''), a.password_hash) AND a.active;
  END IF;

  IF NOT ok THEN
    INSERT INTO base.sign_in_failures AS x (username, ip, failures, locked_until)
    VALUES (u, v_ip, 1, NULL)
    ON CONFLICT (username, ip) DO UPDATE SET
      failures     = CASE WHEN x.locked_until IS NOT NULL THEN 1 ELSE x.failures + 1 END,
      locked_until = CASE WHEN x.locked_until IS NULL AND x.failures + 1 >= 5 THEN now() + interval '5 minutes' END;
    RETURN QUERY SELECT 'bad', NULL::text, NULL::text, NULL::boolean; RETURN;
  END IF;

  DELETE FROM base.sign_in_failures x WHERE x.username = u AND x.ip = v_ip;

  IF a.role IS DISTINCT FROM p_page THEN
    RETURN QUERY SELECT 'wrong_page', NULL::text, a.role, NULL::boolean; RETURN;
  END IF;

  t := base.new_token();
  INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at)
  VALUES (base.token_hash(t), a.org_id, a.id, now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 12), 24))));
  UPDATE base.accounts x SET last_sign_in_at = now() WHERE x.id = a.id;
  INSERT INTO base.history (org_id, actor, actor_id, action, subject, detail)
  VALUES (a.org_id, a.full_name, a.id, 'signed in', a.id, jsonb_build_object('page', p_page));

  RETURN QUERY SELECT 'ok', t, a.role, a.must_change_password;
END $$;

CREATE FUNCTION base.sign_out() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.caller();
BEGIN
  IF c.session_id IS NULL THEN RETURN; END IF;
  UPDATE base.sessions SET ended_at = now() WHERE id = c.session_id;
END $$;

CREATE FUNCTION base.change_password(p_current text, p_new text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
DECLARE
  c base.caller := base.need(ARRAY['admin', 'security', 'dock'], true);
  h text;
BEGIN
  SELECT password_hash INTO h FROM base.accounts WHERE id = c.account_id FOR UPDATE;
  IF h <> crypt(coalesce(p_current, ''), h) THEN PERFORM base.bad('Current password is incorrect', 'currentPassword'); END IF;
  PERFORM base.check_password(p_new, 'newPassword');
  IF p_new = p_current THEN PERFORM base.bad('New password must be different', 'newPassword'); END IF;
  UPDATE base.accounts SET password_hash = base.hash_password(p_new), must_change_password = false WHERE id = c.account_id;
  -- Every other session of this person ends; this one carries on.
  UPDATE base.sessions SET ended_at = now() WHERE account_id = c.account_id AND id <> c.session_id AND ended_at IS NULL;
  PERFORM base.note(c, 'changed own password', c.account_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts (admin)
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION base.check_account_fields(p_username text, p_full_name text, p_role text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  IF p_username IS NOT NULL AND p_username !~ '^[a-z0-9._-]{3,40}$' THEN
    PERFORM base.bad('Username: 3-40 characters, letters, numbers, dot, dash or underscore', 'username');
  END IF;
  IF p_full_name IS NOT NULL AND length(p_full_name) > 100 THEN PERFORM base.bad('Full name is too long', 'fullName'); END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'security', 'dock') THEN PERFORM base.bad('Select a role', 'role'); END IF;
END $$;

CREATE FUNCTION base.add_account(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
DECLARE
  c        base.caller := base.need(ARRAY['admin']);
  v_user   text := lower(base.req(p, 'username', 'Username', 40));
  v_name   text := base.req(p, 'fullName', 'Full name', 100);
  v_role   text := base.req(p, 'role', 'Role', 20);
  v_pw     text := p ->> 'password';
  v_id     uuid;
BEGIN
  PERFORM base.check_account_fields(v_user, v_name, v_role);
  PERFORM base.check_password(v_pw, 'password');
  BEGIN
    INSERT INTO base.accounts (org_id, username, full_name, role, password_hash, must_change_password)
    VALUES (c.org_id, v_user, v_name, v_role, base.hash_password(v_pw), true)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This username is taken' USING ERRCODE = 'GH409', DETAIL = 'username';
  END;
  PERFORM base.note(c, 'added account', v_id, jsonb_build_object('username', v_user, 'role', v_role));
  RETURN v_id;
END $$;

CREATE FUNCTION base.update_account(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE
  c      base.caller := base.need(ARRAY['admin']);
  a      base.accounts;
  v_name text := base.txt(p, 'fullName');
  v_role text := base.txt(p, 'role');
  v_act  boolean := (p ->> 'active')::boolean;
BEGIN
  SELECT * INTO a FROM base.accounts WHERE id = p_id AND org_id = c.org_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE = 'GH404'; END IF;
  PERFORM base.check_account_fields(NULL, v_name, v_role);
  IF p_id = c.account_id AND ((v_role IS NOT NULL AND v_role <> 'admin') OR v_act = false) THEN
    PERFORM base.bad('You cannot change your own role or deactivate your own account', 'role');
  END IF;
  UPDATE base.accounts SET
    full_name = coalesce(v_name, full_name),
    role      = coalesce(v_role, role),
    active    = coalesce(v_act, active)
  WHERE id = p_id;
  IF v_act = false OR (v_role IS NOT NULL AND v_role <> a.role) THEN
    UPDATE base.sessions SET ended_at = now() WHERE account_id = p_id AND ended_at IS NULL;
  END IF;
  PERFORM base.note(c, 'changed account', p_id, jsonb_strip_nulls(jsonb_build_object('fullName', v_name, 'role', v_role, 'active', v_act)));
END $$;

CREATE FUNCTION base.reset_password(p_id uuid, p_password text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  PERFORM base.check_password(p_password, 'password');
  UPDATE base.accounts SET password_hash = base.hash_password(p_password), must_change_password = true
   WHERE id = p_id AND org_id = c.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found' USING ERRCODE = 'GH404'; END IF;
  UPDATE base.sessions SET ended_at = now() WHERE account_id = p_id AND ended_at IS NULL;
  PERFORM base.note(c, 'reset a password', p_id);
END $$;

-- A site always keeps at least one active admin.
CREATE FUNCTION base.keep_an_admin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM base.accounts WHERE org_id = OLD.org_id AND role = 'admin' AND active) THEN
    RAISE EXCEPTION 'At least one active admin is required' USING ERRCODE = 'GH409', DETAIL = 'role';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER keep_an_admin AFTER UPDATE OF role, active ON base.accounts
  FOR EACH ROW WHEN (OLD.role = 'admin' AND OLD.active) EXECUTE FUNCTION base.keep_an_admin();

-- ---------------------------------------------------------------------------------------------------------------
-- Kiosks: an admin adds one and gets a one-time pairing code (30 minutes); the tablet enters it once and keeps a
-- kiosk session for a year. Retiring the kiosk ends that session.
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION base.new_pairing_code() RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  -- 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L): about 50 bits.
  SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '' ORDER BY i)
    FROM (SELECT gen_random_bytes(10) AS b) r, generate_series(0, 9) i
$$;

CREATE FUNCTION base.issue_pairing_code(c base.caller, p_kiosk uuid) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
DECLARE code text := base.new_pairing_code();
BEGIN
  UPDATE base.kiosks SET pairing_code_hash = base.token_hash(code), pairing_expires_at = now() + interval '30 minutes'
   WHERE id = p_kiosk AND org_id = c.org_id AND retired_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk not found' USING ERRCODE = 'GH404'; END IF;
  RETURN code;
END $$;

CREATE FUNCTION base.add_kiosk(p_label text) RETURNS TABLE (id uuid, code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
#variable_conflict use_column
DECLARE c base.caller := base.need(ARRAY['admin']); v_id uuid; v_label text := nullif(btrim(p_label), '');
BEGIN
  IF v_label IS NULL THEN PERFORM base.bad('Name the kiosk, for example "Front lobby"', 'label'); END IF;
  IF length(v_label) > 60 THEN PERFORM base.bad('Kiosk name is too long', 'label'); END IF;
  BEGIN
    INSERT INTO base.kiosks (org_id, label) VALUES (c.org_id, v_label) RETURNING kiosks.id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A kiosk with this name already exists' USING ERRCODE = 'GH409', DETAIL = 'label';
  END;
  PERFORM base.note(c, 'added kiosk', v_id, jsonb_build_object('label', v_label));
  RETURN QUERY SELECT v_id, base.issue_pairing_code(c, v_id);
END $$;

CREATE FUNCTION base.repair_kiosk(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']); code text;
BEGIN
  code := base.issue_pairing_code(c, p_id);
  UPDATE base.sessions SET ended_at = now() WHERE kiosk_id = p_id AND ended_at IS NULL;
  PERFORM base.note(c, 'new kiosk pairing code', p_id);
  RETURN code;
END $$;

CREATE FUNCTION base.retire_kiosk(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  UPDATE base.kiosks SET retired_at = now(), pairing_code_hash = NULL, pairing_expires_at = NULL
   WHERE id = p_id AND org_id = c.org_id AND retired_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk not found' USING ERRCODE = 'GH404'; END IF;
  UPDATE base.sessions SET ended_at = now() WHERE kiosk_id = p_id AND ended_at IS NULL;
  PERFORM base.note(c, 'retired kiosk', p_id);
END $$;

-- Called by the tablet without a session. Same lockout as sign-in, keyed on the address.
CREATE FUNCTION base.pair_kiosk(p_code text, p_ip text)
RETURNS TABLE (outcome text, token text, label text, site text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
#variable_conflict use_column
DECLARE
  v_ip text := left(coalesce(p_ip, ''), 64);
  f  base.sign_in_failures;
  k  base.kiosks;
  t  text;
BEGIN
  SELECT * INTO f FROM base.sign_in_failures x WHERE x.username = '#kiosk-pairing' AND x.ip = v_ip;
  IF f.locked_until > now() THEN RETURN QUERY SELECT 'locked', NULL::text, NULL::text, NULL::text; RETURN; END IF;

  SELECT * INTO k FROM base.kiosks x
   WHERE x.pairing_code_hash = base.token_hash(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')))
     AND x.pairing_expires_at > now() AND x.retired_at IS NULL;
  IF k.id IS NULL THEN
    INSERT INTO base.sign_in_failures AS x (username, ip, failures, locked_until)
    VALUES ('#kiosk-pairing', v_ip, 1, NULL)
    ON CONFLICT (username, ip) DO UPDATE SET
      failures     = CASE WHEN x.locked_until IS NOT NULL THEN 1 ELSE x.failures + 1 END,
      locked_until = CASE WHEN x.locked_until IS NULL AND x.failures + 1 >= 5 THEN now() + interval '5 minutes' END;
    RETURN QUERY SELECT 'bad', NULL::text, NULL::text, NULL::text; RETURN;
  END IF;

  DELETE FROM base.sign_in_failures x WHERE x.username = '#kiosk-pairing' AND x.ip = v_ip;
  UPDATE base.kiosks SET pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = now() WHERE id = k.id;
  t := base.new_token();
  INSERT INTO base.sessions (token_hash, org_id, kiosk_id, expires_at)
  VALUES (base.token_hash(t), k.org_id, k.id, now() + interval '365 days');
  INSERT INTO base.history (org_id, actor, actor_id, action, subject) VALUES (k.org_id, 'Kiosk: ' || k.label, k.id, 'kiosk paired', k.id);
  RETURN QUERY SELECT 'ok', t, k.label, (SELECT o.name FROM base.orgs o WHERE o.id = k.org_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- New site (the owner's onboarding command only; never granted to the app)
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION base.create_site(p_name text, p_admin_username text, p_admin_name text, p_password text) RETURNS uuid
LANGUAGE plpgsql SET search_path = pg_catalog, public, base AS $$
DECLARE v_org uuid; v_admin uuid;
BEGIN
  PERFORM base.check_account_fields(lower(btrim(p_admin_username)), p_admin_name, 'admin');
  PERFORM base.check_password(p_password, 'password');
  INSERT INTO base.orgs (name) VALUES (btrim(p_name)) RETURNING id INTO v_org;
  INSERT INTO base.accounts (org_id, username, full_name, role, password_hash, must_change_password)
  VALUES (v_org, lower(btrim(p_admin_username)), btrim(p_admin_name), 'admin', base.hash_password(p_password), true)
  RETURNING id INTO v_admin;
  INSERT INTO base.history (org_id, actor, action, subject, detail)
  VALUES (v_org, 'Onboarding', 'site created', v_org, jsonb_build_object('admin', lower(btrim(p_admin_username))));
  RETURN v_org;
END $$;

CREATE FUNCTION base.history_intact(p_org uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, base AS $$
DECLARE h base.history; prev bytea;
BEGIN
  FOR h IN SELECT * FROM base.history WHERE org_id = p_org ORDER BY seq LOOP
    IF h.prev_hash IS DISTINCT FROM prev OR h.hash <> base.history_row_hash(h) THEN RETURN false; END IF;
    prev := h.hash;
  END LOOP;
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- What the app may read (row-level security) and call
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE base.orgs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_site ON base.orgs FOR SELECT USING (id = (SELECT base.org()));

ALTER TABLE base.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_see_own_site ON base.accounts FOR SELECT
  USING (org_id = (SELECT base.org()) AND (SELECT base.role()) = 'admin');

ALTER TABLE base.kiosks ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_see_own_site ON base.kiosks FOR SELECT
  USING (org_id = (SELECT base.org()) AND (SELECT base.role()) = 'admin');

ALTER TABLE base.history ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_see_own_site ON base.history FOR SELECT
  USING (org_id = (SELECT base.org()) AND (SELECT base.role()) = 'admin');

ALTER TABLE base.sessions ENABLE ROW LEVEL SECURITY;          -- no policy, no grant: never readable by the app
ALTER TABLE base.sign_in_failures ENABLE ROW LEVEL SECURITY;  -- same

GRANT SELECT (id, name, created_at) ON base.orgs TO gatehouse_app;
GRANT SELECT (id, org_id, username, full_name, role, active, must_change_password, created_at, last_sign_in_at)
  ON base.accounts TO gatehouse_app;
GRANT SELECT (id, org_id, label, pairing_expires_at, paired_at, retired_at, created_at) ON base.kiosks TO gatehouse_app;
GRANT SELECT (seq, org_id, at, actor, action, subject, detail) ON base.history TO gatehouse_app;

GRANT EXECUTE ON FUNCTION
  base.caller(), base.org(), base.role(),
  base.sign_in(text, text, text, text, int), base.sign_out(), base.change_password(text, text),
  base.add_account(jsonb), base.update_account(uuid, jsonb), base.reset_password(uuid, text),
  base.add_kiosk(text), base.repair_kiosk(uuid), base.retire_kiosk(uuid), base.pair_kiosk(text, text)
TO gatehouse_app;
