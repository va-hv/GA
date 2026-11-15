-- 003: what the admin console needs. Site settings (name and the safety wording people see), the list of signed-in
-- sessions with a way to end them, a history tamper check and a site summary. All admin-only, all for the caller's
-- own site.

SET LOCAL ROLE gatehouse_owner;

CREATE TABLE base.site_settings (
  org_id         uuid PRIMARY KEY REFERENCES base.orgs(id),
  safety_visitor text[] NOT NULL CHECK (cardinality(safety_visitor) BETWEEN 1 AND 12),
  safety_driver  text NOT NULL CHECK (length(safety_driver) BETWEEN 1 AND 500),
  kiosk_welcome  text CHECK (length(kiosk_welcome) <= 200),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text
);

-- Every line of the visitor safety rules: 1 to 200 characters.
CREATE FUNCTION base.lines_ok(p text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(bool_and(length(btrim(l)) BETWEEN 1 AND 200), false) FROM unnest(p) l
$$;
ALTER TABLE base.site_settings ADD CONSTRAINT safety_lines_ok CHECK (base.lines_ok(safety_visitor));

CREATE FUNCTION base.default_settings() RETURNS base.site_settings
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, base AS $$
  SELECT NULL::uuid,
    ARRAY['Stay with your host and on marked walkways at all times.',
          'Wear the high-visibility vest and any protective equipment you are given.',
          'Forklifts and trucks have right of way. Never walk behind a reversing vehicle.',
          'In an alarm, leave by the nearest exit and go to the assembly point. Do not use the dock doors.',
          'Report any injury or near miss to your host straight away.'],
    'Stay in or beside the cab unless told otherwise, wear a high-visibility vest outside the cab, chock wheels at the dock, and follow the dock lights.',
    NULL::text, now(), NULL::text
$$;

-- Every site gets the defaults; new sites too.
INSERT INTO base.site_settings (org_id, safety_visitor, safety_driver)
SELECT o.id, d.safety_visitor, d.safety_driver FROM base.orgs o, base.default_settings() d;

CREATE FUNCTION base.settings_for_new_site() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  INSERT INTO base.site_settings (org_id, safety_visitor, safety_driver)
  SELECT NEW.id, d.safety_visitor, d.safety_driver FROM base.default_settings() d;
  RETURN NEW;
END $$;
CREATE TRIGGER settings_for_new_site AFTER INSERT ON base.orgs FOR EACH ROW EXECUTE FUNCTION base.settings_for_new_site();

-- Everyone at the site (staff and kiosk) reads its own settings: the kiosk shows the safety rules.
ALTER TABLE base.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_site ON base.site_settings FOR SELECT USING (org_id = (SELECT base.org()));
GRANT SELECT ON base.site_settings TO gatehouse_app;

-- Change the site name and wording. Only the fields sent change.
CREATE FUNCTION base.update_site(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE
  c       base.caller := base.need(ARRAY['admin']);
  v_name  text := base.txt(p, 'name');
  v_lines text[];
  v_drv   text := base.txt(p, 'safetyDriver');
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
  UPDATE base.site_settings SET updated_at = now(), updated_by = c.name WHERE org_id = c.org_id;
  PERFORM base.note(c, 'changed site settings', c.org_id,
    (SELECT jsonb_object_agg(k, true) FROM jsonb_object_keys(p) k WHERE k IN ('name', 'safetyVisitor', 'safetyDriver', 'kioskWelcome')));
END $$;

-- Who is signed in right now (people and kiosks), without anything that could be used to sign in.
CREATE FUNCTION base.open_sessions()
RETURNS TABLE (id uuid, who text, kind text, role text, started_at timestamptz, expires_at timestamptz, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
#variable_conflict use_column
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  RETURN QUERY
  SELECT s.id, coalesce(a.full_name || ' (' || a.username || ')', 'Kiosk: ' || k.label),
         CASE WHEN s.kiosk_id IS NULL THEN 'person' ELSE 'kiosk' END, coalesce(a.role, 'kiosk'),
         s.created_at, s.expires_at, s.id = c.session_id
    FROM base.sessions s
    LEFT JOIN base.accounts a ON a.id = s.account_id
    LEFT JOIN base.kiosks k ON k.id = s.kiosk_id
   WHERE s.org_id = c.org_id AND s.ended_at IS NULL AND s.expires_at > now()
     AND (a.id IS NULL OR a.active) AND (k.id IS NULL OR k.retired_at IS NULL)
   ORDER BY s.created_at DESC;
END $$;

CREATE FUNCTION base.end_session(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  IF p_id = c.session_id THEN PERFORM base.bad('Use Sign out to end your own session', 'session'); END IF;
  UPDATE base.sessions SET ended_at = now() WHERE id = p_id AND org_id = c.org_id AND ended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found' USING ERRCODE = 'GH404'; END IF;
  PERFORM base.note(c, 'ended a session', p_id);
END $$;

-- Signs out every person at the site except the admin doing it. Kiosks stay paired unless asked.
CREATE FUNCTION base.end_all_sessions(p_kiosks boolean DEFAULT false) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']); n int;
BEGIN
  UPDATE base.sessions SET ended_at = now()
   WHERE org_id = c.org_id AND ended_at IS NULL AND id <> c.session_id
     AND (account_id IS NOT NULL OR coalesce(p_kiosks, false));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM base.note(c, 'signed everyone out', c.org_id, jsonb_build_object('sessions', n, 'kiosks', coalesce(p_kiosks, false)));
  RETURN n;
END $$;

-- Recomputes the hash chain of the site's history.
CREATE FUNCTION base.check_history() RETURNS TABLE (intact boolean, entries bigint, first_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  RETURN QUERY SELECT base.history_intact(c.org_id), count(*), min(h.at) FROM base.history h WHERE h.org_id = c.org_id;
END $$;

-- Numbers for the console's overview.
CREATE FUNCTION base.site_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  RETURN jsonb_build_object(
    'people',          (SELECT count(*) FROM base.accounts WHERE org_id = c.org_id AND active),
    'peopleByRole',    (SELECT coalesce(jsonb_object_agg(role, n), '{}') FROM (SELECT role, count(*) n FROM base.accounts WHERE org_id = c.org_id AND active GROUP BY role) r),
    'temporaryPasswords', (SELECT count(*) FROM base.accounts WHERE org_id = c.org_id AND active AND must_change_password),
    'deactivated',     (SELECT count(*) FROM base.accounts WHERE org_id = c.org_id AND NOT active),
    'kiosks',          (SELECT count(*) FROM base.kiosks WHERE org_id = c.org_id AND retired_at IS NULL),
    'kiosksWaiting',   (SELECT count(*) FROM base.kiosks WHERE org_id = c.org_id AND retired_at IS NULL AND paired_at IS NULL),
    'sessions',        (SELECT count(*) FROM base.sessions WHERE org_id = c.org_id AND ended_at IS NULL AND expires_at > now()),
    'onSiteNow',       (SELECT count(*) FROM gate.visits WHERE org_id = c.org_id AND status <> 'left'),
    'visits30Days',    (SELECT count(*) FROM gate.visits WHERE org_id = c.org_id AND arrived_at > now() - interval '30 days'),
    'visitsAllTime',   (SELECT count(*) FROM gate.visits WHERE org_id = c.org_id),
    'trucks30Days',    (SELECT count(*) FROM gate.visits WHERE org_id = c.org_id AND kind = 'driver' AND arrived_at > now() - interval '30 days'),
    'gateCorrections30Days', (SELECT count(*) FROM base.history WHERE org_id = c.org_id AND action = 'released at gate'
                                AND (detail ->> 'correctedDock')::boolean AND at > now() - interval '30 days'),
    'lastChange',      (SELECT max(at) FROM base.history WHERE org_id = c.org_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION base.update_site(jsonb), base.open_sessions(), base.end_session(uuid),
  base.end_all_sessions(boolean), base.check_history(), base.site_summary() TO gatehouse_app;
