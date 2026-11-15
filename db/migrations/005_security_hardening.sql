-- 005: security hardening.
--   history check: settings-independent hashing, and a fingerprint the customer can keep outside the database
--   bulk log downloads are recorded; the full export stays admin-only
--   two-step sign-in (time-based codes), required for admins unless a site turns that off
--   retention: photos and personal details of closed visits are removed after a per-site period; an admin can
--            erase one visit on request; names no longer go into the history
--   two admins demoting each other at once can no longer leave a site without an admin

SET LOCAL ROLE gatehouse_owner;

-- ---------------------------------------------------------------------------------------------------------------
-- the hash no longer depends on the session's time zone or date style
-- ---------------------------------------------------------------------------------------------------------------
ALTER FUNCTION base.history_row_hash(base.history) STABLE SET TimeZone = 'UTC' SET DateStyle = 'ISO, MDY' SET IntervalStyle = 'postgres';
ALTER FUNCTION base.history_chain() SET TimeZone = 'UTC' SET DateStyle = 'ISO, MDY' SET IntervalStyle = 'postgres';
ALTER FUNCTION base.history_intact(uuid) SET TimeZone = 'UTC' SET DateStyle = 'ISO, MDY' SET IntervalStyle = 'postgres';

-- ---------------------------------------------------------------------------------------------------------------
-- the fingerprint. The admin console and every export show the latest entry number and its hash; keeping a copy
-- outside the server lets a later check catch a rewritten chain or removed latest entries.
-- ---------------------------------------------------------------------------------------------------------------
DROP FUNCTION base.check_history();
CREATE FUNCTION base.check_history()
RETURNS TABLE (intact boolean, entries bigint, first_at timestamptz, fingerprint text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  RETURN QUERY
  SELECT base.history_intact(c.org_id), count(*), min(h.at),
         (SELECT encode(x.hash, 'hex') FROM base.history x WHERE x.org_id = c.org_id ORDER BY x.seq DESC LIMIT 1)
    FROM base.history h WHERE h.org_id = c.org_id;
END $$;

-- Compares a saved fingerprint (entry number N and its hash) with the chain today: entry N must still carry that hash,
-- and the chain must be intact. Catches a rewritten chain and removed entries up to N.
CREATE FUNCTION base.compare_fingerprint(p_entries bigint, p_fingerprint text)
RETURNS TABLE (matches boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE
  c base.caller := base.need(ARRAY['admin']);
  have bigint;
  h text;
BEGIN
  IF p_entries IS NULL OR p_entries < 1 THEN PERFORM base.bad('Enter the number of entries from the saved fingerprint', 'entries'); END IF;
  IF coalesce(p_fingerprint, '') !~ '^[0-9a-fA-F]{64}$' THEN PERFORM base.bad('A fingerprint is 64 characters, 0-9 and a-f', 'fingerprint'); END IF;
  SELECT count(*) INTO have FROM base.history WHERE org_id = c.org_id;
  IF have < p_entries THEN
    RETURN QUERY SELECT false, format('The history has %s entries now, fewer than the %s saved: entries were removed.', have, p_entries); RETURN;
  END IF;
  SELECT encode(x.hash, 'hex') INTO h FROM base.history x WHERE x.org_id = c.org_id ORDER BY x.seq OFFSET p_entries - 1 LIMIT 1;
  IF h <> lower(p_fingerprint) THEN
    RETURN QUERY SELECT false, format('Entry %s does not match the saved fingerprint: the history before it was rewritten.', p_entries); RETURN;
  END IF;
  IF NOT base.history_intact(c.org_id) THEN
    RETURN QUERY SELECT false, 'The saved entry matches, but a later entry was changed.'; RETURN;
  END IF;
  RETURN QUERY SELECT true, format('Matches: the first %s entries are exactly as when the fingerprint was taken, and every later entry checks out.', p_entries);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- a log download (one day, CSV) is recorded, by any staff role
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION base.record_download(p_day date, p_rows int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin', 'security', 'dock']);
BEGIN
  PERFORM base.note(c, 'downloaded the log', c.org_id, jsonb_build_object('day', p_day, 'rows', p_rows));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Site settings: two-step for admins, retention periods
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE base.site_settings
  ADD COLUMN require_two_step_admins boolean NOT NULL DEFAULT true,
  ADD COLUMN keep_photo_days int NOT NULL DEFAULT 30 CHECK (keep_photo_days BETWEEN 1 AND 365),
  ADD COLUMN keep_personal_days int NOT NULL DEFAULT 365 CHECK (keep_personal_days BETWEEN 30 AND 3650),
  ADD CONSTRAINT photos_go_first CHECK (keep_photo_days <= keep_personal_days);

-- ---------------------------------------------------------------------------------------------------------------
-- two-step sign-in
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE base.accounts
  ADD COLUMN totp_secret bytea,
  ADD COLUMN totp_pending bytea,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_counter bigint,
  ADD CONSTRAINT two_step_complete CHECK ((totp_secret IS NULL) = (totp_enabled_at IS NULL));
GRANT SELECT (totp_enabled_at) ON base.accounts TO gatehouse_app;   -- never the secret

CREATE FUNCTION base.base32(p bytea) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE abc text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; bits text := ''; result text := ''; i int;
BEGIN
  FOR i IN 0 .. length(p) - 1 LOOP bits := bits || get_byte(p, i)::bit(8)::text; END LOOP;
  WHILE length(bits) % 5 <> 0 LOOP bits := bits || '0'; END LOOP;
  FOR i IN 0 .. length(bits) / 5 - 1 LOOP
    result := result || substr(abc, 1 + substring(bits FROM i * 5 + 1 FOR 5)::bit(5)::int, 1);
  END LOOP;
  RETURN result;
END $$;

-- RFC 6238 code (SHA-1, 30 seconds, 6 digits) for one time step.
CREATE FUNCTION base.totp_at(p_secret bytea, p_counter bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE h bytea := hmac(int8send(p_counter), p_secret, 'sha1'); o int; v bigint;
BEGIN
  o := get_byte(h, 19) & 15;
  v := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16)
     | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint;
  RETURN lpad((v % 1000000)::text, 6, '0');
END $$;

-- The time step a code matches (one step either side for clock drift), never one already used; NULL if none.
CREATE FUNCTION base.totp_match(p_secret bytea, p_code text, p_after bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, base AS $$
DECLARE now_step bigint := floor(extract(epoch FROM now()) / 30)::bigint; code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g'); d int;
BEGIN
  IF p_secret IS NULL OR length(code) <> 6 THEN RETURN NULL; END IF;
  FOR d IN -1 .. 1 LOOP
    IF now_step + d > coalesce(p_after, -1) AND base.totp_at(p_secret, now_step + d) = code THEN RETURN now_step + d; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Who is calling, now also: must this admin set up two-step before doing anything else?
ALTER TYPE base.caller ADD ATTRIBUTE must_set_up_two_step boolean;
CREATE OR REPLACE FUNCTION base.caller() RETURNS base.caller
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
  SELECT s.id, s.org_id, s.account_id, s.kiosk_id,
         CASE WHEN s.kiosk_id IS NOT NULL THEN 'kiosk' ELSE a.role END,
         coalesce(a.full_name, 'Kiosk: ' || k.label),
         coalesce(a.must_change_password, false),
         coalesce(a.role = 'admin' AND a.totp_enabled_at IS NULL AND ss.require_two_step_admins, false)
    FROM base.sessions s
    LEFT JOIN base.accounts a ON a.id = s.account_id
    LEFT JOIN base.kiosks k   ON k.id = s.kiosk_id
    LEFT JOIN base.site_settings ss ON ss.org_id = s.org_id
   WHERE s.token_hash = base.token_hash(nullif(current_setting('gatehouse.token', true), ''))
     AND s.ended_at IS NULL
     AND s.expires_at > now()
     AND (a.id IS NULL OR a.active)
     AND (k.id IS NULL OR k.retired_at IS NULL)
$$;

-- p_allow_setup lets the password page and the two-step page work before the account is fully set up.
CREATE OR REPLACE FUNCTION base.need(p_roles text[], p_allow_must_change boolean DEFAULT false) RETURNS base.caller
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.caller();
BEGIN
  IF c.session_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in' USING ERRCODE = 'GH401';
  END IF;
  IF c.must_change AND NOT p_allow_must_change THEN
    RAISE EXCEPTION 'You must change your password before continuing' USING ERRCODE = 'GH428';
  END IF;
  IF c.must_set_up_two_step AND NOT p_allow_must_change THEN
    RAISE EXCEPTION 'Set up two-step sign-in before continuing' USING ERRCODE = 'GH426';
  END IF;
  IF NOT (c.role = ANY (p_roles)) THEN
    RAISE EXCEPTION 'Your role cannot do this' USING ERRCODE = 'GH403';
  END IF;
  RETURN c;
END $$;

-- Sign-in, now with the code for accounts that use two-step. Outcomes: ok, bad, locked, wrong_page, need_code.
-- A wrong code counts as a failed sign-in (lockout), like a wrong password.
DROP FUNCTION base.sign_in(text, text, text, text, int);
CREATE FUNCTION base.sign_in(p_username text, p_password text, p_page text, p_ip text, p_hours int DEFAULT 12, p_code text DEFAULT NULL)
RETURNS TABLE (outcome text, token text, role text, must_change boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
#variable_conflict use_column
DECLARE
  u    text := lower(btrim(coalesce(p_username, '')));
  v_ip text := left(coalesce(p_ip, ''), 64);
  a    base.accounts;
  f    base.sign_in_failures;
  ok   boolean;
  step bigint;
  t    text;
BEGIN
  SELECT * INTO f FROM base.sign_in_failures x WHERE x.username = u AND x.ip = v_ip;
  IF f.locked_until > now() THEN
    RETURN QUERY SELECT 'locked', NULL::text, NULL::text, NULL::boolean; RETURN;
  END IF;

  SELECT * INTO a FROM base.accounts x WHERE x.username = u;
  IF a.id IS NULL THEN
    PERFORM crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    ok := false;
  ELSE
    ok := a.password_hash = crypt(coalesce(p_password, ''), a.password_hash) AND a.active;
  END IF;

  IF ok AND a.role IS NOT DISTINCT FROM p_page AND a.totp_secret IS NOT NULL THEN
    IF nullif(btrim(coalesce(p_code, '')), '') IS NULL THEN
      RETURN QUERY SELECT 'need_code', NULL::text, NULL::text, NULL::boolean; RETURN;
    END IF;
    step := base.totp_match(a.totp_secret, p_code, a.totp_last_counter);
    ok := step IS NOT NULL;
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

  IF step IS NOT NULL THEN UPDATE base.accounts x SET totp_last_counter = step WHERE x.id = a.id; END IF;
  t := base.new_token();
  INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at)
  VALUES (base.token_hash(t), a.org_id, a.id, now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 12), 24))));
  UPDATE base.accounts x SET last_sign_in_at = now() WHERE x.id = a.id;
  INSERT INTO base.history (org_id, actor, actor_id, action, subject, detail)
  VALUES (a.org_id, a.full_name, a.id, 'signed in', a.id, jsonb_build_object('page', p_page, 'twoStep', step IS NOT NULL));

  RETURN QUERY SELECT 'ok', t, a.role, a.must_change_password;
END $$;

-- Start setting up: a new secret, kept as pending until a code from it is confirmed.
CREATE FUNCTION base.start_two_step() RETURNS TABLE (secret text, uri text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
#variable_conflict use_column
DECLARE c base.caller := base.need(ARRAY['admin', 'security', 'dock'], true); s bytea := gen_random_bytes(20); u text; site text;
BEGIN
  IF c.must_change THEN PERFORM base.bad('Choose your own password first', 'twoStep'); END IF;
  UPDATE base.accounts SET totp_pending = s WHERE id = c.account_id RETURNING username INTO u;
  SELECT name INTO site FROM base.orgs WHERE id = c.org_id;
  RETURN QUERY SELECT base.base32(s),
    'otpauth://totp/Gatehouse:' || u || '?secret=' || base.base32(s) || '&issuer=Gatehouse&algorithm=SHA1&digits=6&period=30';
END $$;

CREATE FUNCTION base.confirm_two_step(p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin', 'security', 'dock'], true); a base.accounts; step bigint;
BEGIN
  SELECT * INTO a FROM base.accounts WHERE id = c.account_id FOR UPDATE;
  IF a.totp_pending IS NULL THEN PERFORM base.bad('Start the set-up again', 'code'); END IF;
  step := base.totp_match(a.totp_pending, p_code, NULL);
  IF step IS NULL THEN PERFORM base.bad('That code does not match. Check the time on your phone and try the newest code.', 'code'); END IF;
  UPDATE base.accounts SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_counter = step
   WHERE id = c.account_id;
  UPDATE base.sessions SET ended_at = now() WHERE account_id = c.account_id AND id <> c.session_id AND ended_at IS NULL;
  PERFORM base.note(c, 'turned on two-step sign-in', c.account_id);
END $$;

CREATE FUNCTION base.turn_off_two_step(p_password text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin', 'security', 'dock']); a base.accounts;
BEGIN
  SELECT * INTO a FROM base.accounts WHERE id = c.account_id FOR UPDATE;
  IF a.password_hash <> crypt(coalesce(p_password, ''), a.password_hash) THEN PERFORM base.bad('Password is incorrect', 'currentPassword'); END IF;
  IF a.role = 'admin' AND (SELECT require_two_step_admins FROM base.site_settings WHERE org_id = c.org_id) THEN
    PERFORM base.bad('This site requires two-step sign-in for admins', 'twoStep');
  END IF;
  UPDATE base.accounts SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = c.account_id;
  PERFORM base.note(c, 'turned off two-step sign-in', c.account_id);
END $$;

-- An admin clears someone's two-step (lost phone). They sign in with their password and set it up again.
CREATE FUNCTION base.reset_two_step(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  IF p_id = c.account_id THEN PERFORM base.bad('Another admin has to reset your two-step sign-in', 'twoStep'); END IF;
  UPDATE base.accounts SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_counter = NULL
   WHERE id = p_id AND org_id = c.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found' USING ERRCODE = 'GH404'; END IF;
  UPDATE base.sessions SET ended_at = now() WHERE account_id = p_id AND ended_at IS NULL;
  PERFORM base.note(c, 'reset two-step sign-in', p_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- lock the site's admins before changing anyone, so two admins cannot remove each other at once
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION base.update_account(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE
  c      base.caller := base.need(ARRAY['admin']);
  a      base.accounts;
  v_name text := base.txt(p, 'fullName');
  v_role text := base.txt(p, 'role');
  v_act  boolean := (p ->> 'active')::boolean;
BEGIN
  PERFORM 1 FROM base.accounts WHERE org_id = c.org_id AND role = 'admin' ORDER BY id FOR UPDATE;
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

-- ---------------------------------------------------------------------------------------------------------------
-- retention and erasure
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE gate.visits ADD COLUMN redacted_at timestamptz;
ALTER TABLE gate.visits ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE gate.visits ADD CONSTRAINT phone_unless_erased CHECK (phone IS NOT NULL OR redacted_at IS NOT NULL);
ALTER TABLE gate.visits ADD CONSTRAINT erased_only_after_leaving CHECK (redacted_at IS NULL OR status = 'left');

ALTER TABLE gate.visits DROP CONSTRAINT kiosk_people_need_contact;
ALTER TABLE gate.visits ADD CONSTRAINT kiosk_people_need_contact CHECK (
  kind = 'driver' OR host_name IS NOT NULL AND (email IS NOT NULL OR redacted_at IS NOT NULL));
ALTER TABLE gate.visits DROP CONSTRAINT contractors_need_company_and_insurance;
ALTER TABLE gate.visits ADD CONSTRAINT contractors_need_company_and_insurance CHECK (
  kind <> 'contractor' OR company IS NOT NULL AND (insurance_no IS NOT NULL OR redacted_at IS NOT NULL));
ALTER TABLE gate.visits DROP CONSTRAINT drivers_need_truck_details;
ALTER TABLE gate.visits ADD CONSTRAINT drivers_need_truck_details CHECK (
  kind <> 'driver' OR (
    company IS NOT NULL AND (driver_licence IS NOT NULL OR redacted_at IS NOT NULL) AND scac IS NOT NULL AND vehicle_type IS NOT NULL
    AND visit_reason IS NOT NULL AND truck_plate IS NOT NULL AND truck_no IS NOT NULL AND appointment_no IS NOT NULL
    AND bobtail IS NOT NULL AND purpose IN ('Live', 'Drop') AND email IS NULL AND host_name IS NULL AND photo IS NULL));

-- Closed visits stay frozen, with two exceptions: the photo may be removed, and the personal details may be erased
-- (name replaced, contact and ID numbers emptied). The business record (company, truck, trailer, seals, times) stays.
CREATE OR REPLACE FUNCTION gate.guard_visit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, gate AS $$
BEGIN
  IF OLD.status = 'left' THEN
    IF (OLD.org_id, OLD.kind, OLD.status, OLD.purpose, OLD.safety_accepted, OLD.company, OLD.host_name, OLD.id_scanned,
        OLD.scac, OLD.vehicle_type, OLD.visit_reason, OLD.truck_plate, OLD.truck_no, OLD.appointment_no, OLD.bobtail,
        OLD.trailer_in, OLD.arrived_empty, OLD.seal_in, OLD.going_empty, OLD.trailer_out, OLD.seal_out, OLD.arrived_at,
        OLD.arrived_via, OLD.arrived_by, OLD.dock_cleared_at, OLD.dock_cleared_by, OLD.left_at, OLD.released_by)
       IS NOT DISTINCT FROM
       (NEW.org_id, NEW.kind, NEW.status, NEW.purpose, NEW.safety_accepted, NEW.company, NEW.host_name, NEW.id_scanned,
        NEW.scac, NEW.vehicle_type, NEW.visit_reason, NEW.truck_plate, NEW.truck_no, NEW.appointment_no, NEW.bobtail,
        NEW.trailer_in, NEW.arrived_empty, NEW.seal_in, NEW.going_empty, NEW.trailer_out, NEW.seal_out, NEW.arrived_at,
        NEW.arrived_via, NEW.arrived_by, NEW.dock_cleared_at, NEW.dock_cleared_by, NEW.left_at, NEW.released_by)
    THEN
      -- photo removal only
      IF NEW.photo IS NULL AND NEW.redacted_at IS NOT DISTINCT FROM OLD.redacted_at
         AND (NEW.full_name, NEW.phone, NEW.email, NEW.insurance_no, NEW.driver_licence)
             IS NOT DISTINCT FROM (OLD.full_name, OLD.phone, OLD.email, OLD.insurance_no, OLD.driver_licence) THEN
        RETURN NEW;
      END IF;
      -- erasure
      IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.full_name = 'Removed' AND NEW.photo IS NULL
         AND NEW.phone IS NULL AND NEW.email IS NULL AND NEW.insurance_no IS NULL AND NEW.driver_licence IS NULL THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'This visit is closed: they have already left the site' USING ERRCODE = 'GH409';
  END IF;
  IF (OLD.org_id, OLD.kind, OLD.full_name, OLD.phone, OLD.purpose, OLD.safety_accepted, OLD.company, OLD.email,
      OLD.host_name, OLD.insurance_no, OLD.id_scanned, OLD.photo, OLD.driver_licence, OLD.scac, OLD.vehicle_type,
      OLD.visit_reason, OLD.truck_plate, OLD.truck_no, OLD.appointment_no, OLD.bobtail, OLD.trailer_in,
      OLD.arrived_empty, OLD.seal_in, OLD.arrived_at, OLD.arrived_via, OLD.arrived_by, OLD.redacted_at)
     IS DISTINCT FROM
     (NEW.org_id, NEW.kind, NEW.full_name, NEW.phone, NEW.purpose, NEW.safety_accepted, NEW.company, NEW.email,
      NEW.host_name, NEW.insurance_no, NEW.id_scanned, NEW.photo, NEW.driver_licence, NEW.scac, NEW.vehicle_type,
      NEW.visit_reason, NEW.truck_plate, NEW.truck_no, NEW.appointment_no, NEW.bobtail, NEW.trailer_in,
      NEW.arrived_empty, NEW.seal_in, NEW.arrived_at, NEW.arrived_via, NEW.arrived_by, NEW.redacted_at) THEN
    RAISE EXCEPTION 'Arrival details cannot be changed after check-in' USING ERRCODE = 'GH409';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'on_site' AND NEW.status = 'left' AND NEW.kind = 'driver' THEN
    RAISE EXCEPTION 'Dock coordinator approval is required before this driver can leave the gate' USING ERRCODE = 'GH409';
  END IF;
  IF (OLD.status, NEW.status) NOT IN (('on_site', 'dock_cleared'), ('dock_cleared', 'on_site'),
                                      ('on_site', 'left'), ('dock_cleared', 'left')) THEN
    RAISE EXCEPTION 'A visit cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'GH409';
  END IF;
  RETURN NEW;
END $$;

-- Applies every site's own retention periods. Needs no session: it only ever removes what a site's settings say
-- has expired, and writes what it did to that site's history. The API runs it hourly.
CREATE FUNCTION gate.apply_retention() RETURNS TABLE (site uuid, photos int, erased int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
#variable_conflict use_column
DECLARE s record; p int; e int;
BEGIN
  FOR s IN SELECT org_id, keep_photo_days, keep_personal_days FROM base.site_settings LOOP
    UPDATE gate.visits SET photo = NULL
     WHERE org_id = s.org_id AND status = 'left' AND photo IS NOT NULL AND left_at < now() - make_interval(days => s.keep_photo_days);
    GET DIAGNOSTICS p = ROW_COUNT;
    UPDATE gate.visits SET redacted_at = now(), full_name = 'Removed', photo = NULL, phone = NULL, email = NULL,
           insurance_no = NULL, driver_licence = NULL
     WHERE org_id = s.org_id AND status = 'left' AND redacted_at IS NULL AND left_at < now() - make_interval(days => s.keep_personal_days);
    GET DIAGNOSTICS e = ROW_COUNT;
    IF p + e > 0 THEN
      INSERT INTO base.history (org_id, actor, action, subject, detail)
      VALUES (s.org_id, 'Retention', 'removed expired personal data', s.org_id, jsonb_build_object('photos', p, 'visits', e));
      RETURN QUERY SELECT s.org_id, p, e;
    END IF;
  END LOOP;
END $$;

-- An admin erases one person's details on request (after they have left).
CREATE FUNCTION gate.erase_visit(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['admin']); v gate.visits;
BEGIN
  SELECT * INTO v FROM gate.visits WHERE id = p_id AND org_id = c.org_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE = 'GH404'; END IF;
  IF v.status <> 'left' THEN RAISE EXCEPTION 'Check them out first; details can be erased once they have left' USING ERRCODE = 'GH409'; END IF;
  IF v.redacted_at IS NOT NULL THEN RAISE EXCEPTION 'Already erased' USING ERRCODE = 'GH409'; END IF;
  UPDATE gate.visits SET redacted_at = now(), full_name = 'Removed', photo = NULL, phone = NULL, email = NULL,
         insurance_no = NULL, driver_licence = NULL
   WHERE id = p_id;
  PERFORM base.note(c, 'erased personal details', p_id);
END $$;

-- Kiosk check-in without names in the history (the visit itself holds them, and they can be erased there).
CREATE OR REPLACE FUNCTION gate.kiosk_check_in(p jsonb) RETURNS TABLE (id uuid, full_name text, kind text, arrived_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
#variable_conflict use_column
DECLARE
  c        base.caller := base.need(ARRAY['kiosk']);
  v_kind   text := lower(coalesce(p ->> 'role', p ->> 'kind', ''));
  v_name   text; v_email text; v_phone text; v_purpose text; v_host text; v_company text; v_ins text; v_photo text;
  v_id     uuid;
BEGIN
  IF v_kind NOT IN ('visitor', 'contractor') THEN PERFORM base.bad('Choose visitor or contractor', 'role'); END IF;
  v_name    := base.req(p, 'fullName', 'Full name');
  v_email   := base.req(p, 'email', 'Email');
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN PERFORM base.bad('Enter a valid email', 'email'); END IF;
  v_phone   := gate.check_phone(base.req(p, 'phone', 'Phone number', 40));
  v_purpose := base.req(p, 'purpose', 'Purpose of visit', 255);
  v_host    := base.req(p, 'hostName', 'Person being visited');
  IF v_kind = 'contractor' THEN
    v_company := base.req(p, 'companyName', 'Company name');
    v_ins     := base.req(p, 'insuranceNumber', 'Insurance number', 80);
  END IF;
  v_photo := nullif(p ->> 'photoData', '');
  IF v_photo IS NOT NULL AND (v_photo NOT LIKE 'data:image/%' OR length(v_photo) > 4000000) THEN
    PERFORM base.bad('Photo must be an image under 3 MB', 'photoData');
  END IF;
  IF NOT gate.flag(p, 'safetyAccepted') THEN PERFORM base.bad('You must accept the safety declaration', 'safetyAccepted'); END IF;

  INSERT INTO gate.visits AS v (org_id, kind, full_name, email, phone, purpose, host_name, company, insurance_no,
                                id_scanned, photo, safety_accepted, arrived_via, arrived_by)
  VALUES (c.org_id, v_kind, v_name, v_email, v_phone, v_purpose, v_host, v_company, v_ins,
          gate.flag(p, 'idScanned'), v_photo, true, c.name, c.kiosk_id)
  RETURNING v.id INTO v_id;
  PERFORM base.note(c, v_kind || ' checked in', v_id, jsonb_build_object('photo', v_photo IS NOT NULL));
  RETURN QUERY SELECT v.id, v.full_name, v.kind, v.arrived_at FROM gate.visits v WHERE v.id = v_id;
END $$;

-- Site settings: the new fields
CREATE OR REPLACE FUNCTION base.update_site(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE
  c       base.caller := base.need(ARRAY['admin']);
  v_name  text := base.txt(p, 'name');
  v_lines text[];
  v_drv   text := base.txt(p, 'safetyDriver');
  v_int   int;
BEGIN
  IF p ? 'name' THEN
    IF v_name IS NULL THEN PERFORM base.bad('Site name is required', 'name'); END IF;
    IF length(v_name) > 120 THEN PERFORM base.bad('Site name is too long', 'name'); END IF;
    UPDATE base.orgs SET name = v_name WHERE id = c.org_id;
  END IF;
  IF p ? 'safetyVisitor' THEN
    IF jsonb_typeof(p -> 'safetyVisitor') <> 'array' THEN PERFORM base.bad('Safety rules must be a list', 'safetyVisitor'); END IF;
    SELECT array_agg(btrim(x) ORDER BY i) INTO v_lines
      FROM jsonb_array_elements_text(p -> 'safetyVisitor') WITH ORDINALITY AS t(x, i) WHERE btrim(x) <> '';
    IF cardinality(v_lines) IS NULL OR cardinality(v_lines) < 1 THEN PERFORM base.bad('Keep at least one safety rule', 'safetyVisitor'); END IF;
    IF cardinality(v_lines) > 12 THEN PERFORM base.bad('Twelve safety rules at most', 'safetyVisitor'); END IF;
    IF NOT base.lines_ok(v_lines) THEN PERFORM base.bad('Each safety rule is 200 characters at most', 'safetyVisitor'); END IF;
    UPDATE base.site_settings SET safety_visitor = v_lines WHERE org_id = c.org_id;
  END IF;
  IF p ? 'safetyDriver' THEN
    IF v_drv IS NULL THEN PERFORM base.bad('The driver safety note is required', 'safetyDriver'); END IF;
    IF length(v_drv) > 500 THEN PERFORM base.bad('The driver safety note is 500 characters at most', 'safetyDriver'); END IF;
    UPDATE base.site_settings SET safety_driver = v_drv WHERE org_id = c.org_id;
  END IF;
  IF p ? 'kioskWelcome' THEN
    IF length(base.txt(p, 'kioskWelcome')) > 200 THEN PERFORM base.bad('The welcome note is 200 characters at most', 'kioskWelcome'); END IF;
    UPDATE base.site_settings SET kiosk_welcome = base.txt(p, 'kioskWelcome') WHERE org_id = c.org_id;
  END IF;
  IF p ? 'requireTwoStepAdmins' THEN
    IF jsonb_typeof(p -> 'requireTwoStepAdmins') <> 'boolean' THEN PERFORM base.bad('Choose yes or no', 'requireTwoStepAdmins'); END IF;
    UPDATE base.site_settings SET require_two_step_admins = (p ->> 'requireTwoStepAdmins')::boolean WHERE org_id = c.org_id;
  END IF;
  IF p ? 'keepPhotoDays' THEN
    v_int := (p ->> 'keepPhotoDays')::int;
    IF v_int IS NULL OR v_int NOT BETWEEN 1 AND 365 THEN PERFORM base.bad('Keep photos between 1 and 365 days', 'keepPhotoDays'); END IF;
    UPDATE base.site_settings SET keep_photo_days = v_int WHERE org_id = c.org_id;
  END IF;
  IF p ? 'keepPersonalDays' THEN
    v_int := (p ->> 'keepPersonalDays')::int;
    IF v_int IS NULL OR v_int NOT BETWEEN 30 AND 3650 THEN PERFORM base.bad('Keep personal details between 30 and 3,650 days', 'keepPersonalDays'); END IF;
    UPDATE base.site_settings SET keep_personal_days = v_int WHERE org_id = c.org_id;
  END IF;
  IF (SELECT keep_photo_days > keep_personal_days FROM base.site_settings WHERE org_id = c.org_id) THEN
    PERFORM base.bad('Photos cannot be kept longer than the other personal details', 'keepPhotoDays');
  END IF;
  UPDATE base.site_settings SET updated_at = now(), updated_by = c.name WHERE org_id = c.org_id;
  PERFORM base.note(c, 'changed site settings', c.org_id,
    (SELECT jsonb_object_agg(k, true) FROM jsonb_object_keys(p) k
      WHERE k IN ('name', 'safetyVisitor', 'safetyDriver', 'kioskWelcome', 'requireTwoStepAdmins', 'keepPhotoDays', 'keepPersonalDays')));
END $$;

GRANT EXECUTE ON FUNCTION
  base.check_history(), base.compare_fingerprint(bigint, text), base.record_download(date, int),
  base.sign_in(text, text, text, text, int, text), base.start_two_step(), base.confirm_two_step(text),
  base.turn_off_two_step(text), base.reset_two_step(uuid), gate.apply_retention(), gate.erase_visit(uuid)
TO gatehouse_app;
