-- Database rule tests. Run with `make test`. Everything happens in one transaction that is rolled back at the end,
-- so the tests leave nothing behind. Prints "ALL n PASSED" or lists what failed and stops with an error.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\o /dev/null
BEGIN;

CREATE SCHEMA t;
CREATE TABLE t.results (n serial PRIMARY KEY, name text NOT NULL, ok boolean NOT NULL, info text);
CREATE TABLE t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT USAGE ON SCHEMA t TO gatehouse_app;
GRANT SELECT, INSERT, UPDATE ON t.results, t.ids TO gatehouse_app;
GRANT USAGE ON SEQUENCE t.results_n_seq TO gatehouse_app;

CREATE FUNCTION t.as_(p_token text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('gatehouse.token', coalesce(p_token, ''), true) $$;
CREATE FUNCTION t.id(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t.ids WHERE name = p_name $$;
CREATE FUNCTION t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = excluded.id RETURNING id $$;
CREATE FUNCTION t.ok(p_name text, p_cond boolean, p_info text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t.results (name, ok, info) VALUES (p_name, coalesce(p_cond, false), p_info) $$;

-- The statement must run without error.
CREATE FUNCTION t.runs(p_name text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t.results (name, ok, info) VALUES (p_name, false, SQLSTATE || ': ' || SQLERRM);
    RETURN;
  END;
  INSERT INTO t.results (name, ok) VALUES (p_name, true);
END $$;

-- The statement must be refused with this error code (and, if given, a message containing p_msg).
CREATE FUNCTION t.refused(p_name text, p_sql text, p_code text, p_msg text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t.results (name, ok, info) VALUES (p_name,
      SQLSTATE = p_code AND (p_msg IS NULL OR SQLERRM ILIKE '%' || p_msg || '%'),
      SQLSTATE || ': ' || SQLERRM);
    RETURN;
  END;
  INSERT INTO t.results (name, ok, info) VALUES (p_name, false, 'was allowed');
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Two sites with staff, a kiosk and some broken sessions
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE a uuid; b uuid; acc uuid; k uuid;
BEGIN
  a := t.keep('siteA', base.create_site('Test site A', 't-admin-a', 'Ada Admin', 'TestPass123'));
  b := t.keep('siteB', base.create_site('Test site B', 't-admin-b', 'Bo Admin', 'TestPass123'));
  UPDATE base.accounts SET must_change_password = false WHERE org_id IN (a, b);
  UPDATE base.site_settings SET require_two_step_admins = false WHERE org_id IN (a, b);
  PERFORM t.keep('A-admin', id) FROM base.accounts WHERE username = 't-admin-a';

  INSERT INTO base.accounts (org_id, username, full_name, role, password_hash, must_change_password)
  VALUES (a, 't-sec-a', 'Sam Security', 'security', base.hash_password('TestPass123'), false),
         (a, 't-dock-a', 'Dee Dock', 'dock', base.hash_password('TestPass123'), false),
         (a, 't-new-a', 'Nia New', 'security', base.hash_password('TestPass123'), true),
         (a, 't-gone-a', 'Gil Gone', 'security', base.hash_password('TestPass123'), false),
         (b, 't-sec-b', 'Bea Security', 'security', base.hash_password('TestPass123'), false);
  UPDATE base.accounts SET active = false WHERE username = 't-gone-a';

  INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at)
  SELECT base.token_hash(x.token), ac.org_id, ac.id, now() + x.life
    FROM (VALUES ('A-admin', 't-admin-a', interval '1 hour'), ('A-sec', 't-sec-a', interval '1 hour'),
                 ('A-dock', 't-dock-a', interval '1 hour'), ('A-new', 't-new-a', interval '1 hour'),
                 ('A-gone', 't-gone-a', interval '1 hour'), ('A-expired', 't-sec-a', interval '-1 minute'),
                 ('B-admin', 't-admin-b', interval '1 hour'), ('B-sec', 't-sec-b', interval '1 hour'),
                 ('A-sec-2', 't-sec-a', interval '1 hour')) AS x(token, username, life)
    JOIN base.accounts ac ON ac.username = x.username;
  INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at, ended_at)
  SELECT base.token_hash('A-ended'), org_id, id, now() + interval '1 hour', now() FROM base.accounts WHERE username = 't-sec-a';

  INSERT INTO base.kiosks (org_id, label) VALUES (a, 'Lobby') RETURNING id INTO k;
  INSERT INTO base.sessions (token_hash, org_id, kiosk_id, expires_at) VALUES (base.token_hash('A-kiosk'), a, k, now() + interval '1 day');
  INSERT INTO base.kiosks (org_id, label, retired_at) VALUES (a, 'Old tablet', now()) RETURNING id INTO k;
  INSERT INTO base.sessions (token_hash, org_id, kiosk_id, expires_at) VALUES (base.token_hash('A-kiosk-retired'), a, k, now() + interval '1 day');
END $$;

CREATE FUNCTION t.driver(p_plate text, p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('fullName', 'Dan Driver', 'phone', '+1 416 555 0101', 'driverLicense', 'D1234-56789',
    'companyName', 'Maple Freight', 'scacCode', 'mpfx', 'vehicleType', '53" Trailer', 'truckLicensePlate', p_plate,
    'truckNumber', 'T-77', 'appointmentNumber', 'APT-1001', 'visitReason', 'Inbound', 'purpose', 'Live',
    'bobtail', false, 'trailerNoIn', 'TR-500', 'arrivedEmpty', false, 'sealNoIn', 'SL-900', 'safetyAccepted', true) || p_extra
$$;
CREATE FUNCTION t.visitor(p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('role', 'VISITOR', 'fullName', 'Vera Visitor', 'email', 'vera@example.com', 'phone', '416-555-0199',
    'purpose', 'Meeting', 'hostName', 'Ada Admin', 'safetyAccepted', true) || p_extra
$$;

SET ROLE gatehouse_app;

-- ---------------------------------------------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_(NULL);
SELECT t.refused('no session: cannot check a driver in', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH401');
SELECT t.refused('no session: kiosk check-in refused', $$SELECT gate.kiosk_check_in(t.visitor())$$, 'GH401');
SELECT t.as_('A-expired');
SELECT t.refused('expired session refused', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH401');
SELECT t.as_('A-ended');
SELECT t.refused('signed-out session refused', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH401');
SELECT t.as_('A-gone');
SELECT t.refused('deactivated account refused', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH401');
SELECT t.as_('A-kiosk-retired');
SELECT t.refused('retired kiosk refused', $$SELECT gate.kiosk_check_in(t.visitor())$$, 'GH401');
SELECT t.as_('made-up-token');
SELECT t.refused('made-up token refused', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH401');
SELECT t.as_('A-new');
SELECT t.refused('must change password first', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH428');
SELECT t.refused('password change checks the current password', $$SELECT base.change_password('wrong', 'NewPass12345')$$, 'GH400', 'incorrect');
SELECT t.refused('new password must follow the rule', $$SELECT base.change_password('TestPass123', 'short1')$$, 'GH400', 'at least 10');
SELECT t.runs('must-change account can change its password', $$SELECT base.change_password('TestPass123', 'NewPass12345')$$);
SELECT t.runs('after the change the account can work', $$SELECT gate.driver_check_in(t.driver('NEW001'))$$);

-- ---------------------------------------------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('A-kiosk');
SELECT t.refused('kiosk cannot check a driver in', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH403');
SELECT t.ok('kiosk reads no visits', (SELECT count(*) FROM gate.visits) = 0);
SELECT t.refused('kiosk cannot add accounts', $$SELECT base.add_account('{"username":"x-kiosk","fullName":"X","role":"admin","password":"TestPass123"}')$$, 'GH403');
SELECT t.as_('A-dock');
SELECT t.refused('dock cannot check a driver in', $$SELECT gate.driver_check_in(t.driver('AAA111'))$$, 'GH403');
SELECT t.refused('dock cannot use the kiosk', $$SELECT gate.kiosk_check_in(t.visitor())$$, 'GH403');
SELECT t.as_('A-sec');
SELECT t.refused('security cannot use the kiosk', $$SELECT gate.kiosk_check_in(t.visitor())$$, 'GH403');
SELECT t.refused('security cannot add accounts', $$SELECT base.add_account('{"username":"x-sec","fullName":"X","role":"admin","password":"TestPass123"}')$$, 'GH403');
SELECT t.refused('security cannot clear at the dock', format('SELECT gate.dock_clear(%L, %L)', gen_random_uuid(), '{"goingEmpty":true}'), 'GH403');
SELECT t.refused('app cannot insert visits directly', $$INSERT INTO gate.visits (org_id, kind, full_name, phone, purpose, safety_accepted, arrived_via) VALUES (base.org(), 'visitor', 'X', '4165550000', 'x', true, 'x')$$, '42501');
SELECT t.refused('app cannot update visits directly', $$UPDATE gate.visits SET status = 'left'$$, '42501');
SELECT t.refused('app cannot read sessions', $$SELECT count(*) FROM base.sessions$$, '42501');
SELECT t.refused('app cannot read password hashes', $$SELECT password_hash FROM base.accounts$$, '42501');
SELECT t.refused('app cannot create sites', $$SELECT base.create_site('X', 'x-site', 'X', 'TestPass123')$$, '42501');
SELECT t.refused('app cannot write history', $$INSERT INTO base.history (org_id, actor, action, hash) VALUES (base.org(), 'x', 'x', '\x00')$$, '42501');

-- ---------------------------------------------------------------------------------------------------------------
-- Kiosk check-in
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('A-kiosk');
SELECT t.keep('visitor1', (SELECT id FROM gate.kiosk_check_in(t.visitor())));
SELECT t.ok('visitor checks in at the kiosk', t.id('visitor1') IS NOT NULL);
SELECT t.refused('kiosk: safety declaration required', $$SELECT gate.kiosk_check_in(t.visitor('{"safetyAccepted":false}'))$$, 'GH400', 'safety');
SELECT t.refused('kiosk: valid email required', $$SELECT gate.kiosk_check_in(t.visitor('{"email":"not-an-email"}'))$$, 'GH400', 'email');
SELECT t.refused('kiosk: host required', $$SELECT gate.kiosk_check_in(t.visitor('{"hostName":"  "}'))$$, 'GH400', 'visited');
SELECT t.refused('kiosk: contractor needs insurance', $$SELECT gate.kiosk_check_in(t.visitor('{"role":"CONTRACTOR","companyName":"Fixit"}'))$$, 'GH400', 'Insurance');
SELECT t.refused('kiosk: drivers cannot self check in', $$SELECT gate.kiosk_check_in(t.visitor('{"role":"DRIVER"}'))$$, 'GH400');
SELECT t.refused('kiosk: photo must be an image', $$SELECT gate.kiosk_check_in(t.visitor('{"photoData":"javascript:alert(1)"}'))$$, 'GH400', 'image');
SELECT t.runs('contractor checks in with company and insurance', $$SELECT gate.kiosk_check_in(t.visitor('{"role":"CONTRACTOR","companyName":"Fixit","insuranceNumber":"INS-1"}'))$$);

-- ---------------------------------------------------------------------------------------------------------------
-- Driver check-in
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('A-sec');
SELECT t.keep('truck1', gate.driver_check_in(t.driver('abc123')));
SELECT t.ok('driver checked in, plate and SCAC upper case',
  (SELECT truck_plate = 'ABC123' AND scac = 'MPFX' AND status = 'on_site' FROM gate.visits WHERE id = t.id('truck1')));
SELECT t.refused('same truck cannot be on site twice', $$SELECT gate.driver_check_in(t.driver('ABC123'))$$, 'GH409', 'already on site');
SELECT t.refused('trailer IN required unless bobtail', $$SELECT gate.driver_check_in(t.driver('T2', '{"trailerNoIn":""}'))$$, 'GH400', 'Trailer No. IN');
SELECT t.refused('seal IN required when loaded', $$SELECT gate.driver_check_in(t.driver('T3', '{"sealNoIn":null}'))$$, 'GH400', 'Seal');
SELECT t.refused('SCAC is 2 to 4 letters', $$SELECT gate.driver_check_in(t.driver('T4', '{"scacCode":"M1"}'))$$, 'GH400', 'SCAC');
SELECT t.refused('vehicle type from the list', $$SELECT gate.driver_check_in(t.driver('T5', '{"vehicleType":"Spaceship"}'))$$, 'GH400', 'vehicle');
SELECT t.refused('safety acknowledged', $$SELECT gate.driver_check_in(t.driver('T6', '{"safetyAccepted":false}'))$$, 'GH400', 'Safety');
SELECT t.keep('empty1', gate.driver_check_in(t.driver('EMP1', '{"arrivedEmpty":true,"sealNoIn":"IGNORED"}')));
SELECT t.ok('arrived empty: no seal stored', (SELECT seal_in IS NULL AND arrived_empty FROM gate.visits WHERE id = t.id('empty1')));
SELECT t.keep('bob1', gate.driver_check_in(t.driver('BOB1', '{"bobtail":true,"trailerNoIn":"IGNORED"}')));
SELECT t.ok('bobtail: no trailer or seal stored',
  (SELECT trailer_in IS NULL AND seal_in IS NULL AND arrived_empty IS NULL FROM gate.visits WHERE id = t.id('bob1')));

-- ---------------------------------------------------------------------------------------------------------------
-- Departure: dock, then gate
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.refused('driver cannot leave without dock clearance', format('SELECT gate.release(%L, NULL)', t.id('truck1')), 'GH409', 'Dock coordinator approval');
SELECT t.as_('A-dock');
SELECT t.refused('dock: loaded needs trailer OUT', format('SELECT gate.dock_clear(%L, %L)', t.id('truck1'), '{"goingEmpty":false,"sealNoOut":"S1"}'), 'GH400', 'Trailer No. OUT');
SELECT t.refused('dock: loaded needs seal OUT', format('SELECT gate.dock_clear(%L, %L)', t.id('truck1'), '{"goingEmpty":false,"trailerNoOut":"TR-1"}'), 'GH400', 'Seal No. OUT');
SELECT t.runs('dock clears a loaded truck', format('SELECT gate.dock_clear(%L, %L)', t.id('truck1'), '{"goingEmpty":false,"trailerNoOut":"TR-OUT-1","sealNoOut":"SL-OUT-1"}'));
SELECT t.refused('dock cannot clear twice', format('SELECT gate.dock_clear(%L, %L)', t.id('truck1'), '{"goingEmpty":true}'), 'GH409', 'already cleared');
SELECT t.runs('dock withdraws a clearance', format('SELECT gate.dock_reopen(%L)', t.id('truck1')));
SELECT t.ok('withdrawn clearance clears trailer and seal OUT',
  (SELECT status = 'on_site' AND trailer_out IS NULL AND seal_out IS NULL AND dock_cleared_at IS NULL FROM gate.visits WHERE id = t.id('truck1')));
SELECT t.refused('cannot withdraw what is not cleared', format('SELECT gate.dock_reopen(%L)', t.id('truck1')), 'GH409');
SELECT t.runs('dock clears it again', format('SELECT gate.dock_clear(%L, %L)', t.id('truck1'), '{"goingEmpty":false,"trailerNoOut":"TR-OUT-1","sealNoOut":"SL-OUT-1"}'));
SELECT t.runs('dock clears the bobtail going empty', format('SELECT gate.dock_clear(%L, %L)', t.id('bob1'), '{"goingEmpty":true,"trailerNoOut":"X"}'));
SELECT t.ok('dock sees drivers only', (SELECT count(*) FILTER (WHERE kind <> 'driver') = 0 AND count(*) > 0 FROM gate.visits));
SELECT t.refused('dock cannot touch a visitor', format('SELECT gate.dock_clear(%L, %L)', t.id('visitor1'), '{"goingEmpty":true}'), 'GH404');
SELECT t.refused('dock cannot release at the gate', format('SELECT gate.release(%L, NULL)', t.id('truck1')), 'GH403');

SELECT t.as_('A-sec');
SELECT t.runs('security releases with a corrected seal', format('SELECT gate.release(%L, %L)', t.id('truck1'), '{"sealNoOut":"SL-OUT-FIXED"}'));
SELECT t.ok('release keeps the dock trailer and the corrected seal',
  (SELECT status = 'left' AND trailer_out = 'TR-OUT-1' AND seal_out = 'SL-OUT-FIXED' AND left_at IS NOT NULL AND released_by = 'Sam Security'
     FROM gate.visits WHERE id = t.id('truck1')));
SELECT t.refused('cannot release twice', format('SELECT gate.release(%L, NULL)', t.id('truck1')), 'GH409', 'Already');
SELECT t.runs('bobtail released empty', format('SELECT gate.release(%L, NULL)', t.id('bob1')));
SELECT t.refused('an empty trailer still needs the dock first', format('SELECT gate.release(%L, %L)', t.id('empty1'), '{}'), 'GH409');
SELECT t.runs('the same truck can come back after it left', $$SELECT gate.driver_check_in(t.driver('ABC123'))$$);
SELECT t.runs('security checks a visitor out', format('SELECT gate.release(%L, NULL)', t.id('visitor1')));

SELECT t.as_('A-dock');
SELECT t.refused('dock cannot reopen a truck that left', format('SELECT gate.dock_reopen(%L)', t.id('truck1')), 'GH409');

-- ---------------------------------------------------------------------------------------------------------------
-- Sites are separate
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('B-sec');
SELECT t.ok('site B sees none of site A', (SELECT count(*) FROM gate.visits) = 0);
SELECT t.refused('site B cannot release site A''s visitor', format('SELECT gate.release(%L, NULL)', t.keep('trk-b', t.id('empty1'))), 'GH404');
SELECT t.runs('site B can check in a plate that is on site at A', $$SELECT gate.driver_check_in(t.driver('EMP1'))$$);
SELECT t.as_('B-admin');
SELECT t.refused('site B admin cannot change a site A account', format('SELECT base.update_account(%L, %L)', t.id('A-admin'), '{"active":false}'), 'GH404');
SELECT t.ok('site B admin sees only site B accounts', (SELECT bool_and(org_id = t.id('siteB')) FROM base.accounts));

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('A-admin');
SELECT t.keep('acct1', base.add_account('{"username":"T-Guard-1","fullName":"Gia Guard","role":"security","password":"TestPass123"}'));
SELECT t.ok('new account must change password, username lower case',
  (SELECT must_change_password AND username = 't-guard-1' FROM base.accounts WHERE id = t.id('acct1')));
SELECT t.refused('username taken', $$SELECT base.add_account('{"username":"t-guard-1","fullName":"Gia","role":"security","password":"TestPass123"}')$$, 'GH409', 'taken');
SELECT t.refused('weak password refused', $$SELECT base.add_account('{"username":"t-guard-2","fullName":"Gia","role":"security","password":"onlyletters"}')$$, 'GH400', 'number');
SELECT t.refused('unknown role refused', $$SELECT base.add_account('{"username":"t-guard-3","fullName":"Gia","role":"owner","password":"TestPass123"}')$$, 'GH400', 'role');
SELECT t.refused('admin cannot deactivate self', format('SELECT base.update_account(%L, %L)', t.id('A-admin'), '{"active":false}'), 'GH400', 'own');
SELECT t.refused('admin cannot demote self', format('SELECT base.update_account(%L, %L)', t.id('A-admin'), '{"role":"dock"}'), 'GH400', 'own');
SELECT t.ok('admin sees own site accounts, no hashes', (SELECT count(*) >= 5 FROM base.accounts));
SELECT t.ok('admin reads history', (SELECT count(*) > 0 FROM base.history));

SELECT t.as_('A-sec');
SELECT t.ok('security reads no accounts', (SELECT count(*) FROM base.accounts) = 0);
SELECT t.ok('security reads no history', (SELECT count(*) FROM base.history) = 0);

SELECT t.as_('A-admin');
SELECT t.runs('admin resets a password', format('SELECT base.reset_password(%L, %L)', (SELECT id FROM base.accounts WHERE username = 't-sec-a'), 'Temporary123'));
SELECT t.as_('A-sec-2');
SELECT t.refused('reset password ends that person''s sessions', $$SELECT gate.driver_check_in(t.driver('ZZZ1'))$$, 'GH401');

SELECT t.as_('A-admin');
SELECT t.runs('admin deactivates an account', format('SELECT base.update_account(%L, %L)', (SELECT id FROM base.accounts WHERE username = 't-dock-a'), '{"active":false}'));
SELECT t.as_('A-dock');
SELECT t.refused('deactivated person is out at once', format('SELECT gate.dock_reopen(%L)', t.id('empty1')), 'GH401');

-- ---------------------------------------------------------------------------------------------------------------
-- Signing in
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_(NULL);
SELECT t.ok('sign in works on the right page', (SELECT outcome = 'ok' AND length(token) > 30 FROM base.sign_in('t-sec-b', 'TestPass123', 'security', '10.0.0.1')));
SELECT t.ok('right password, wrong page says which page', (SELECT outcome = 'wrong_page' AND role = 'security' AND token IS NULL FROM base.sign_in('t-sec-b', 'TestPass123', 'admin', '10.0.0.1')));
SELECT t.ok('wrong password refused', (SELECT outcome = 'bad' FROM base.sign_in('t-sec-b', 'nope', 'security', '10.0.0.2')));
SELECT t.ok('unknown name refused the same way', (SELECT outcome = 'bad' FROM base.sign_in('nobody-here', 'nope', 'security', '10.0.0.2')));
SELECT t.ok('deactivated account cannot sign in', (SELECT outcome = 'bad' FROM base.sign_in('t-gone-a', 'TestPass123', 'security', '10.0.0.3')));
SELECT (base.sign_in('t-sec-b', 'nope', 'security', '10.0.0.2')).outcome FROM generate_series(1, 4);
SELECT t.ok('five failures lock the account at that address', (SELECT outcome = 'locked' FROM base.sign_in('t-sec-b', 'TestPass123', 'security', '10.0.0.2')));
SELECT t.ok('the lock is per address', (SELECT outcome = 'ok' FROM base.sign_in('t-sec-b', 'TestPass123', 'security', '10.0.0.9')));

-- ---------------------------------------------------------------------------------------------------------------
-- Kiosk pairing
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.as_('A-admin');
CREATE TEMP TABLE pairing AS SELECT * FROM base.add_kiosk('Dock office');
SELECT t.ok('admin adds a kiosk and gets a 10-character code', (SELECT length(code) = 10 FROM pairing));
SELECT t.refused('kiosk names are unique per site', $$SELECT base.add_kiosk('dock office')$$, 'GH409');
SELECT t.as_(NULL);
SELECT t.ok('a wrong code does not pair', (SELECT outcome = 'bad' FROM base.pair_kiosk('WRONGCODE1', '10.1.1.1')));
SELECT t.ok('the code pairs the tablet (dashes and case ignored)',
  (SELECT p.outcome = 'ok' AND p.site = 'Test site A' FROM pairing, base.pair_kiosk(lower(substr(pairing.code, 1, 5)) || '-' || substr(pairing.code, 6), '10.1.1.1') p));
SELECT t.ok('a code works once', (SELECT p.outcome = 'bad' FROM pairing, base.pair_kiosk(pairing.code, '10.1.1.1') p));

-- ---------------------------------------------------------------------------------------------------------------
-- Admin console (003)
-- ---------------------------------------------------------------------------------------------------------------
SELECT t.ok('every site starts with safety wording', (SELECT count(*) = 0 FROM base.orgs o WHERE NOT EXISTS (SELECT 1 FROM base.site_settings s WHERE s.org_id = o.id)));
SELECT t.as_('B-sec');
SELECT t.refused('security cannot change site settings', $$SELECT base.update_site('{"name":"Hacked"}')$$, 'GH403');
SELECT t.refused('security cannot list sessions', $$SELECT * FROM base.open_sessions()$$, 'GH403');
SELECT t.refused('security cannot sign everyone out', $$SELECT base.end_all_sessions()$$, 'GH403');
SELECT t.refused('security cannot record an export', $$SELECT base.record_export()$$, 'GH403');
SELECT t.refused('security cannot check the history', $$SELECT * FROM base.check_history()$$, 'GH403');
SELECT t.ok('security reads its own site settings only', (SELECT count(*) = 1 AND bool_and(org_id = t.id('siteB')) FROM base.site_settings));
SELECT t.refused('app cannot write settings directly', $$UPDATE base.site_settings SET safety_driver = 'x'$$, '42501');

SELECT t.as_('A-admin');
SELECT t.runs('admin renames the site and rewrites the safety rules', $$SELECT base.update_site('{"name":"Test site A renamed","safetyVisitor":["Rule one","  ","Rule two"],"safetyDriver":"Driver rule"}')$$);
SELECT t.ok('blank safety lines are dropped', (SELECT safety_visitor = ARRAY['Rule one', 'Rule two'] AND updated_by = 'Ada Admin' FROM base.site_settings));
SELECT t.ok('the new name shows', (SELECT name = 'Test site A renamed' FROM base.orgs));
SELECT t.refused('at least one safety rule', $$SELECT base.update_site('{"safetyVisitor":[]}')$$, 'GH400', 'at least one');
SELECT t.refused('at most twelve safety rules', format('SELECT base.update_site(%L)', jsonb_build_object('safetyVisitor', (SELECT jsonb_agg('rule ' || i) FROM generate_series(1, 13) i))), 'GH400', 'Twelve');
SELECT t.refused('site name cannot be blank', $$SELECT base.update_site('{"name":"  "}')$$, 'GH400', 'name');
SELECT t.as_('A-kiosk');
SELECT t.ok('the kiosk reads the new safety rules', (SELECT safety_visitor[1] = 'Rule one' FROM base.site_settings));
SELECT t.as_('B-admin');
SELECT t.ok('another site keeps its own wording', (SELECT safety_visitor[1] <> 'Rule one' FROM base.site_settings));

RESET ROLE;
SELECT t.keep('B-sec-session', (SELECT id FROM base.sessions WHERE token_hash = base.token_hash('B-sec')));
SET ROLE gatehouse_app;
SELECT t.as_('A-admin');
SELECT t.ok('admin sees open sessions, marked "me", never other sites', (SELECT count(*) FILTER (WHERE is_me) = 1 AND count(*) >= 2 AND bool_and(who NOT LIKE 'Bea%') FROM base.open_sessions()));
SELECT t.refused('admin cannot end own session here', format('SELECT base.end_session(%L)', (SELECT id FROM base.open_sessions() WHERE is_me)), 'GH400');
SELECT t.refused('admin cannot end another site''s session', format('SELECT base.end_session(%L)', t.id('B-sec-session')), 'GH404');
SELECT t.runs('admin records an export', $$SELECT base.record_export()$$);
SELECT t.ok('history check says intact', (SELECT intact AND entries > 0 FROM base.check_history()));
SELECT t.ok('summary counts the site', (SELECT (s ->> 'people')::int >= 3 AND (s ->> 'kiosks')::int >= 1 FROM base.site_summary() s));
SELECT t.ok('everyone else signed out, admin and kiosk stay', (SELECT base.end_all_sessions() >= 1));
SELECT t.ok('the admin is still signed in', (SELECT session_id IS NOT NULL FROM base.caller()));
SELECT t.as_('A-new');
SELECT t.ok('other people are signed out', (SELECT session_id IS NULL FROM base.caller()));
SELECT t.as_('A-kiosk');
SELECT t.ok('the kiosk stays paired', (SELECT session_id IS NOT NULL FROM base.caller()));
SELECT t.as_('B-sec');
SELECT t.ok('other sites are untouched', (SELECT session_id IS NOT NULL FROM base.caller()));
RESET ROLE;
SELECT t.keep('siteC', base.create_site('Test site C', 't-admin-c', 'Cy Admin', 'TestPass123'));
SELECT t.ok('a new site gets default wording', (SELECT cardinality(s.safety_visitor) = 5 FROM base.site_settings s WHERE s.org_id = t.id('siteC')));
SET ROLE gatehouse_app;

-- ---------------------------------------------------------------------------------------------------------------
-- Security hardening (005)
-- ---------------------------------------------------------------------------------------------------------------
RESET ROLE;
SELECT t.ok('codes match the standard''s test value (RFC 6238)', base.totp_at('12345678901234567890'::bytea, 1) = '287082');
SELECT t.ok('authenticator keys are standard base32', base.base32('12345678901234567890'::bytea) = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
SET LOCAL TimeZone = 'America/Toronto';
SET LOCAL DateStyle = 'German';
SELECT t.ok('history check does not depend on time zone or date style', base.history_intact(t.id('siteA')));
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';

-- Two-step sign-in (site C requires it for admins, the default)
UPDATE base.accounts SET must_change_password = false WHERE username = 't-admin-c';
INSERT INTO base.accounts (org_id, username, full_name, role, password_hash, must_change_password)
VALUES (t.id('siteC'), 't-admin-c2', 'Cal Admin', 'admin', base.hash_password('TestPass123'), false);
INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at)
SELECT base.token_hash('C-admin'), org_id, id, now() + interval '1 hour' FROM base.accounts WHERE username = 't-admin-c';
INSERT INTO base.sessions (token_hash, org_id, account_id, expires_at)
SELECT base.token_hash('C-admin2'), org_id, id, now() + interval '1 hour' FROM base.accounts WHERE username = 't-admin-c2';
SET ROLE gatehouse_app;
SELECT t.as_('C-admin');
SELECT t.refused('an admin without two-step must set it up first', $$SELECT * FROM base.site_summary()$$, 'GH426');
SELECT t.refused('two-step cannot be confirmed before it is started', $$SELECT base.confirm_two_step('123456')$$, 'GH400');
SELECT t.ok('set-up gives a 32-character key and an authenticator link', (SELECT length(secret) = 32 AND uri LIKE 'otpauth://totp/Gatehouse:t-admin-c?secret=%' FROM base.start_two_step()));
SELECT t.refused('a wrong code does not turn it on', $$SELECT base.confirm_two_step('000000')$$, 'GH400', 'does not match');
SELECT t.refused('the app cannot read the secret', $$SELECT totp_secret FROM base.accounts$$, '42501');
RESET ROLE;
CREATE TEMP TABLE codes AS SELECT base.totp_at(totp_pending, floor(extract(epoch FROM now()) / 30)::bigint) AS code FROM base.accounts WHERE username = 't-admin-c';
GRANT SELECT ON codes TO gatehouse_app;
SET ROLE gatehouse_app;
SELECT t.as_('C-admin');
SELECT t.runs('the right code turns two-step on', $$SELECT base.confirm_two_step((SELECT code FROM codes))$$);
SELECT t.runs('then the admin can work', $$SELECT * FROM base.site_summary()$$);
SELECT t.refused('admins cannot turn it off while the site requires it', $$SELECT base.turn_off_two_step('TestPass123')$$, 'GH400', 'requires');
SELECT t.as_(NULL);
SELECT t.ok('the password alone now asks for the code', (SELECT outcome = 'need_code' AND token IS NULL FROM base.sign_in('t-admin-c', 'TestPass123', 'admin', '10.2.0.1')));
SELECT t.ok('a wrong code is refused', (SELECT outcome = 'bad' FROM base.sign_in('t-admin-c', 'TestPass123', 'admin', '10.2.0.1', 12, '000000')));
RESET ROLE;
SELECT t.ok('a wrong code counts toward the lockout', (SELECT failures = 1 FROM base.sign_in_failures WHERE username = 't-admin-c' AND ip = '10.2.0.1'));
SET ROLE gatehouse_app;
SELECT t.ok('a used code cannot be replayed', (SELECT outcome = 'bad' FROM base.sign_in('t-admin-c', 'TestPass123', 'admin', '10.2.0.3', 12, (SELECT code FROM codes))));
SELECT t.ok('a wrong password with a right code is refused', (SELECT outcome = 'bad' FROM base.sign_in('t-admin-c', 'WrongPass123', 'admin', '10.2.0.4', 12, (SELECT code FROM codes))));
SELECT t.as_('C-admin2');
SELECT t.refused('an admin cannot reset their own two-step', format('SELECT base.reset_two_step(%L)', (SELECT session_id FROM base.caller())), 'GH426');
RESET ROLE;
UPDATE base.site_settings SET require_two_step_admins = false WHERE org_id = t.id('siteC');
SET ROLE gatehouse_app;
SELECT t.as_('C-admin2');
SELECT t.runs('another admin resets a lost two-step', format('SELECT base.reset_two_step(%L)', (SELECT id FROM base.accounts WHERE username = 't-admin-c')));
SELECT t.as_(NULL);
SELECT t.ok('after a reset the password alone signs in', (SELECT outcome = 'ok' FROM base.sign_in('t-admin-c', 'TestPass123', 'admin', '10.2.0.5')));
SELECT t.as_('C-admin');
SELECT t.ok('a reset ends that person''s sessions', (SELECT session_id IS NULL FROM base.caller()));

-- Fingerprint
SELECT t.as_('A-admin');
CREATE TEMP TABLE fp AS SELECT entries, fingerprint FROM base.check_history();
SELECT t.ok('the check gives a fingerprint', (SELECT length(fingerprint) = 64 FROM fp));
SELECT t.ok('a saved fingerprint matches today', (SELECT c.matches FROM fp, base.compare_fingerprint(fp.entries, fp.fingerprint) c));
SELECT t.ok('a wrong fingerprint does not', (SELECT NOT c.matches FROM fp, base.compare_fingerprint(fp.entries, repeat('ab', 32)) c));
SELECT t.ok('more entries than exist means some were removed', (SELECT NOT c.matches AND c.reason LIKE '%removed%' FROM fp, base.compare_fingerprint(fp.entries + 1000, fp.fingerprint) c));
SELECT t.refused('a fingerprint must look like one', $$SELECT * FROM base.compare_fingerprint(1, 'nope')$$, 'GH400');

-- Downloads are recorded
SELECT t.as_('B-sec');
SELECT t.runs('security records a log download', $$SELECT base.record_download(current_date, 12)$$);
SELECT t.as_('A-kiosk');
SELECT t.refused('a kiosk cannot download the log', $$SELECT base.record_download(current_date, 1)$$, 'GH403');

-- Erasure and retention
SELECT t.as_('A-admin');
SELECT t.refused('details cannot be erased while someone is on site', format('SELECT gate.erase_visit(%L)', t.id('empty1')), 'GH409', 'Check them out');
SELECT t.runs('admin erases a visitor''s details on request', format('SELECT gate.erase_visit(%L)', t.id('visitor1')));
SELECT t.ok('erased: name replaced, contact gone, visit kept',
  (SELECT full_name = 'Removed' AND email IS NULL AND phone IS NULL AND photo IS NULL AND redacted_at IS NOT NULL AND host_name IS NOT NULL AND status = 'left'
     FROM gate.visits WHERE id = t.id('visitor1')));
SELECT t.refused('erasing twice is refused', format('SELECT gate.erase_visit(%L)', t.id('visitor1')), 'GH409', 'Already');
SELECT t.ok('the history holds no names from the kiosk', NOT EXISTS (SELECT 1 FROM base.history WHERE action LIKE '%checked in' AND action NOT LIKE 'driver%' AND detail ? 'name'
  AND at > (SELECT max(at) FROM base.history WHERE action = 'site created' AND org_id = t.id('siteC'))));
SELECT t.as_('B-sec');
SELECT t.refused('security cannot erase', format('SELECT gate.erase_visit(%L)', t.id('visitor1')), 'GH403');
SELECT t.as_('B-admin');
SELECT t.refused('another site cannot erase', format('SELECT gate.erase_visit(%L)', t.id('truck1')), 'GH404');
RESET ROLE;
INSERT INTO gate.visits (org_id, kind, status, full_name, email, phone, purpose, host_name, safety_accepted, photo, arrived_at, arrived_via, left_at, released_by)
VALUES (t.id('siteA'), 'visitor', 'left', 'Old Visitor', 'old@example.com', '4165550000', 'Old meeting', 'Ada Admin', true, 'data:image/png;base64,AA',
        now() - interval '400 days', 'Kiosk: Lobby', now() - interval '399 days', 'Sam Security'),
       (t.id('siteA'), 'visitor', 'left', 'Recent Visitor', 'new@example.com', '4165550001', 'Meeting', 'Ada Admin', true, 'data:image/png;base64,AA',
        now() - interval '40 days', 'Kiosk: Lobby', now() - interval '40 days', 'Sam Security');
INSERT INTO gate.visits (org_id, kind, full_name, email, phone, purpose, host_name, safety_accepted, photo, arrived_at, arrived_via)
VALUES (t.id('siteA'), 'visitor', 'Never Out', 'never@example.com', '4165550002', 'Forgotten visit', 'Ada Admin', true, 'data:image/png;base64,AA',
        now() - interval '400 days', 'Kiosk: Lobby');
INSERT INTO gate.visits (org_id, kind, full_name, email, phone, purpose, host_name, company, insurance_no, safety_accepted, arrived_at, arrived_via)
VALUES (t.id('siteA'), 'contractor', 'Two Days', 'two@example.com', '4165550003', 'Stale visit', 'Ada Admin', 'Fixit', 'INS-9', true,
        now() - interval '2 days', 'Kiosk: Lobby');
SET ROLE gatehouse_app;
SELECT t.as_(NULL);
SELECT t.ok('retention runs without a session and reports what it removed', (SELECT count(*) >= 1 FROM gate.apply_retention() r WHERE r.site = t.id('siteA') AND r.erased >= 1 AND r.photos >= 1));
RESET ROLE;
SELECT t.ok('a visit past the personal-data period is erased', (SELECT full_name = 'Removed' AND email IS NULL FROM gate.visits WHERE purpose = 'Old meeting' AND org_id = t.id('siteA')));
SELECT t.ok('a visit past the photo period keeps its details but loses the photo', (SELECT full_name = 'Recent Visitor' AND photo IS NULL FROM gate.visits WHERE purpose = 'Meeting' AND full_name <> 'Removed' AND org_id = t.id('siteA') AND left_at < now() - interval '39 days'));
SELECT t.ok('someone never checked out is erased after the period too, and stays on the list as on site',
  (SELECT full_name = 'Removed' AND email IS NULL AND photo IS NULL AND status = 'on_site' FROM gate.visits WHERE purpose = 'Forgotten visit'));
SELECT t.refused('erasing still cannot change anything else on an open visit', format('UPDATE gate.visits SET redacted_at = now(), full_name = %L, phone = NULL, email = NULL, insurance_no = NULL, photo = NULL, purpose = %L WHERE purpose = %L', 'Removed', 'x', 'Stale visit'), 'GH409');
SET ROLE gatehouse_app;
SELECT t.as_('A-admin');
SELECT t.runs('admin erases someone who left without checking out (over a day ago)', $$SELECT gate.erase_visit((SELECT id FROM gate.visits WHERE purpose = 'Stale visit'))$$);
RESET ROLE;
SELECT t.ok('erased, still listed as on site, insurance gone', (SELECT full_name = 'Removed' AND insurance_no IS NULL AND company = 'Fixit' AND status = 'on_site' FROM gate.visits WHERE purpose = 'Stale visit'));
SELECT t.refused('a closed visit still cannot be edited otherwise', format('UPDATE gate.visits SET photo = NULL, company = %L WHERE id = %L', 'Other', t.id('visitor1')), 'GH409', 'closed');
SELECT t.refused('erasing must remove all the details, not some', format('UPDATE gate.visits SET redacted_at = now(), full_name = %L WHERE id = %L', 'Removed', (SELECT id FROM gate.visits WHERE purpose = 'Meeting' AND full_name = 'Recent Visitor')), 'GH409');
SET ROLE gatehouse_app;
SELECT t.as_('A-admin');
SELECT t.refused('retention periods are checked', $$SELECT base.update_site('{"keepPhotoDays":0}')$$, 'GH400');
SELECT t.refused('photos cannot outlive the other details', $$SELECT base.update_site('{"keepPhotoDays":200,"keepPersonalDays":100}')$$, '23514', 'photos_go_first');
SELECT t.runs('admin sets retention and the two-step rule', $$SELECT base.update_site('{"keepPhotoDays":14,"keepPersonalDays":180,"requireTwoStepAdmins":false}')$$);
RESET ROLE;

-- ---------------------------------------------------------------------------------------------------------------
-- The table itself (as the owner, below the rule functions)
-- ---------------------------------------------------------------------------------------------------------------
RESET ROLE;
SELECT t.refused('arrival details cannot change', format('UPDATE gate.visits SET full_name = %L WHERE id = %L', 'Someone Else', t.id('empty1')), 'GH409', 'Arrival details');
SELECT t.refused('a closed visit is frozen', format('UPDATE gate.visits SET released_by = %L WHERE id = %L', 'x', t.id('truck1')), 'GH409', 'closed');
SELECT t.refused('visits are never deleted', format('DELETE FROM gate.visits WHERE id = %L', t.id('empty1')), 'GH409');
SELECT t.refused('no skipping the dock, even directly', format('UPDATE gate.visits SET status = %L, left_at = now(), released_by = %L WHERE id = %L', 'left', 'x', t.id('empty1')), 'GH409', 'Dock coordinator');
SELECT t.refused('cleared means trailer and seal OUT, even directly', format('UPDATE gate.visits SET status = %L, dock_cleared_at = now(), dock_cleared_by = %L, going_empty = false WHERE id = %L', 'dock_cleared', 'x', t.id('empty1')), '23514');
SELECT t.refused('a bobtail has no trailer, even directly', format($q$INSERT INTO gate.visits (org_id, kind, full_name, phone, purpose, safety_accepted, company, driver_licence, scac, vehicle_type, visit_reason, truck_plate, truck_no, appointment_no, bobtail, trailer_in, arrived_via) VALUES (%L, 'driver', 'X', '4165550000', 'Live', true, 'C', 'L', 'AB', 'Van', 'Other', 'Q1', '1', '1', true, 'TR', 'x')$q$, t.id('siteA')), '23514');
SELECT t.refused('the last active admin stays', format('UPDATE base.accounts SET role = %L WHERE id = %L', 'security', t.id('A-admin')), 'GH409', 'admin');
SELECT t.refused('history cannot be edited', $$UPDATE base.history SET actor = 'x'$$, 'GH409');
SELECT t.refused('history cannot be deleted', $$DELETE FROM base.history$$, 'GH409');
SELECT t.ok('history chain intact for both sites', base.history_intact(t.id('siteA')) AND base.history_intact(t.id('siteB')));
ALTER TABLE base.history DISABLE TRIGGER history_append_only;
UPDATE base.history SET detail = '{"tampered":true}' WHERE seq = (SELECT min(seq) FROM base.history WHERE org_id = t.id('siteA'));
ALTER TABLE base.history ENABLE TRIGGER history_append_only;
SELECT t.ok('an edited history row is detected', NOT base.history_intact(t.id('siteA')));

-- ---------------------------------------------------------------------------------------------------------------
\o
\pset tuples_only off
SELECT n, name, info FROM t.results WHERE NOT ok ORDER BY n;
\pset tuples_only on
SELECT CASE WHEN bool_and(ok) THEN 'ALL ' || count(*) || ' PASSED' ELSE count(*) FILTER (WHERE NOT ok) || ' of ' || count(*) || ' FAILED' END FROM t.results;
SELECT CASE WHEN bool_and(ok) THEN 'ok' END AS all_passed FROM t.results \gset
ROLLBACK;
\if :{?all_passed}
\else
  SELECT 'Some database rule tests failed.'::int;
\endif
