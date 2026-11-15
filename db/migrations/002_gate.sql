-- 002: the gate. One row per person who comes through: visitors and contractors (kiosk), truck drivers (security).
--
-- Driver departure takes two people:
--   1. security checks the driver in                      on_site
--   2. the dock coordinator clears the truck at the dock    dock_cleared  (going empty, or trailer and seal OUT)
--      and may withdraw that until the truck has left      back to on_site
--   3. security checks trailer and seal and releases it     left
-- Visitors and contractors go straight from on_site to left (security).
-- A visit that has left is closed: nothing on it can change. Arrival details never change. Nothing is ever deleted.

SET LOCAL ROLE gatehouse_owner;

CREATE SCHEMA gate;
GRANT USAGE ON SCHEMA gate TO gatehouse_app;

CREATE TABLE gate.visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES base.orgs(id),
  kind            text NOT NULL CHECK (kind IN ('visitor', 'contractor', 'driver')),
  status          text NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'dock_cleared', 'left')),

  -- everyone
  full_name       text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 150),
  phone           text NOT NULL CHECK (phone ~ '^[0-9+()\-. ]{6,40}$'),
  purpose         text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 255),
  safety_accepted boolean NOT NULL CHECK (safety_accepted),
  company         text CHECK (length(company) BETWEEN 1 AND 150),

  -- visitors and contractors (kiosk)
  email           text CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 150),
  host_name       text CHECK (length(host_name) BETWEEN 1 AND 150),
  insurance_no    text CHECK (length(insurance_no) BETWEEN 1 AND 80),
  id_scanned      boolean NOT NULL DEFAULT false,
  photo           text CHECK (photo LIKE 'data:image/%' AND length(photo) <= 4000000),

  -- drivers: arrival
  driver_licence  text CHECK (length(driver_licence) BETWEEN 1 AND 80),
  scac            text CHECK (scac ~ '^[A-Z]{2,4}$'),
  vehicle_type    text CHECK (vehicle_type IN ('Tractor', '53" Skirted Trailer', '53" Trailer', 'Box Truck', 'Intermodal Trailer',
                                               'Pup Trailer', 'Refrigerator Trailer', 'Van', 'Garbage BIN', 'Other')),
  visit_reason    text CHECK (visit_reason IN ('Inbound', 'Outbound', 'Non-Inventory', 'Other')),
  truck_plate     text CHECK (truck_plate = upper(truck_plate) AND length(truck_plate) BETWEEN 1 AND 30),
  truck_no        text CHECK (length(truck_no) BETWEEN 1 AND 40),
  appointment_no  text CHECK (length(appointment_no) BETWEEN 1 AND 60),
  bobtail         boolean,
  trailer_in      text CHECK (length(trailer_in) BETWEEN 1 AND 40),
  arrived_empty   boolean,
  seal_in         text CHECK (length(seal_in) BETWEEN 1 AND 40),

  -- drivers: departure
  going_empty     boolean,
  trailer_out     text CHECK (length(trailer_out) BETWEEN 1 AND 40),
  seal_out        text CHECK (length(seal_out) BETWEEN 1 AND 40),

  -- who and when
  arrived_at      timestamptz NOT NULL DEFAULT now(),
  arrived_via     text NOT NULL,
  arrived_by      uuid,
  dock_cleared_at timestamptz,
  dock_cleared_by text,
  left_at         timestamptz,
  released_by     text,

  CONSTRAINT kiosk_people_need_contact CHECK (
    kind = 'driver' OR (email IS NOT NULL AND host_name IS NOT NULL)),
  CONSTRAINT contractors_need_company_and_insurance CHECK (
    kind <> 'contractor' OR (company IS NOT NULL AND insurance_no IS NOT NULL)),
  CONSTRAINT drivers_need_truck_details CHECK (
    kind <> 'driver' OR (
      company IS NOT NULL AND driver_licence IS NOT NULL AND scac IS NOT NULL AND vehicle_type IS NOT NULL
      AND visit_reason IS NOT NULL AND truck_plate IS NOT NULL AND truck_no IS NOT NULL AND appointment_no IS NOT NULL
      AND bobtail IS NOT NULL AND purpose IN ('Live', 'Drop') AND email IS NULL AND host_name IS NULL AND photo IS NULL)),
  CONSTRAINT only_drivers_have_truck_details CHECK (
    kind = 'driver' OR (
      driver_licence IS NULL AND scac IS NULL AND vehicle_type IS NULL AND visit_reason IS NULL AND truck_plate IS NULL
      AND truck_no IS NULL AND appointment_no IS NULL AND bobtail IS NULL AND trailer_in IS NULL AND arrived_empty IS NULL
      AND seal_in IS NULL AND going_empty IS NULL AND trailer_out IS NULL AND seal_out IS NULL
      AND status <> 'dock_cleared' AND dock_cleared_at IS NULL)),
  -- bobtail: tractor alone, so no trailer and no seal IN. Otherwise a trailer, and a seal unless it arrived empty.
  CONSTRAINT trailer_and_seal_in CHECK (
    kind <> 'driver'
    OR (bobtail AND trailer_in IS NULL AND seal_in IS NULL AND arrived_empty IS NULL)
    OR (NOT bobtail AND trailer_in IS NOT NULL AND arrived_empty IS NOT NULL AND arrived_empty = (seal_in IS NULL))),
  -- leaving: still on site means nothing recorded yet; cleared or gone means empty, or trailer and seal OUT.
  CONSTRAINT trailer_and_seal_out CHECK (
    kind <> 'driver'
    OR (status = 'on_site' AND going_empty IS NULL AND trailer_out IS NULL AND seal_out IS NULL
        AND dock_cleared_at IS NULL AND dock_cleared_by IS NULL)
    OR (status <> 'on_site' AND dock_cleared_at IS NOT NULL AND dock_cleared_by IS NOT NULL AND going_empty IS NOT NULL
        AND going_empty = (trailer_out IS NULL) AND going_empty = (seal_out IS NULL))),
  CONSTRAINT left_has_time_and_guard CHECK (
    (status = 'left') = (left_at IS NOT NULL) AND (status = 'left') = (released_by IS NOT NULL))
);

-- The same truck cannot be on site twice.
CREATE UNIQUE INDEX one_truck_on_site ON gate.visits (org_id, truck_plate) WHERE kind = 'driver' AND status <> 'left';
CREATE INDEX visits_by_day ON gate.visits (org_id, arrived_at DESC);
CREATE INDEX visits_on_site ON gate.visits (org_id, status) WHERE status <> 'left';

-- Status can only move along the arrows above; arrival details are fixed; a closed visit is frozen.
CREATE FUNCTION gate.guard_visit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, gate AS $$
BEGIN
  IF OLD.status = 'left' THEN
    RAISE EXCEPTION 'This visit is closed: they have already left the site' USING ERRCODE = 'GH409';
  END IF;
  IF (OLD.org_id, OLD.kind, OLD.full_name, OLD.phone, OLD.purpose, OLD.safety_accepted, OLD.company, OLD.email,
      OLD.host_name, OLD.insurance_no, OLD.id_scanned, OLD.photo, OLD.driver_licence, OLD.scac, OLD.vehicle_type,
      OLD.visit_reason, OLD.truck_plate, OLD.truck_no, OLD.appointment_no, OLD.bobtail, OLD.trailer_in,
      OLD.arrived_empty, OLD.seal_in, OLD.arrived_at, OLD.arrived_via, OLD.arrived_by)
     IS DISTINCT FROM
     (NEW.org_id, NEW.kind, NEW.full_name, NEW.phone, NEW.purpose, NEW.safety_accepted, NEW.company, NEW.email,
      NEW.host_name, NEW.insurance_no, NEW.id_scanned, NEW.photo, NEW.driver_licence, NEW.scac, NEW.vehicle_type,
      NEW.visit_reason, NEW.truck_plate, NEW.truck_no, NEW.appointment_no, NEW.bobtail, NEW.trailer_in,
      NEW.arrived_empty, NEW.seal_in, NEW.arrived_at, NEW.arrived_via, NEW.arrived_by) THEN
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
CREATE TRIGGER guard_visit_change BEFORE UPDATE ON gate.visits FOR EACH ROW EXECUTE FUNCTION gate.guard_visit_change();
CREATE TRIGGER visits_never_deleted BEFORE DELETE ON gate.visits FOR EACH ROW EXECUTE FUNCTION base.refuse_change();
CREATE TRIGGER visits_never_truncated BEFORE TRUNCATE ON gate.visits FOR EACH STATEMENT EXECUTE FUNCTION base.refuse_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Rule functions
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION gate.flag(p jsonb, k text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT coalesce((p ->> k)::boolean, false) $$;

CREATE FUNCTION gate.check_phone(v text) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  IF v !~ '^[0-9+()\-. ]{6,40}$' THEN PERFORM base.bad('Enter a valid phone number', 'phone'); END IF;
  RETURN v;
END $$;

-- Visitors and contractors, at the kiosk.
CREATE FUNCTION gate.kiosk_check_in(p jsonb) RETURNS TABLE (id uuid, full_name text, kind text, arrived_at timestamptz)
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
  PERFORM base.note(c, v_kind || ' checked in', v_id, jsonb_build_object('name', v_name, 'host', v_host));
  RETURN QUERY SELECT v.id, v.full_name, v.kind, v.arrived_at FROM gate.visits v WHERE v.id = v_id;
END $$;

-- Drivers, at the gate, by security.
CREATE FUNCTION gate.driver_check_in(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE
  c          base.caller := base.need(ARRAY['security']);
  v_plate    text;
  v_scac     text;
  v_purpose  text;
  v_vehicle  text;
  v_reason   text;
  v_bobtail  boolean := gate.flag(p, 'bobtail');
  v_empty    boolean := gate.flag(p, 'arrivedEmpty');
  v_trailer  text := base.txt(p, 'trailerNoIn');
  v_seal     text := base.txt(p, 'sealNoIn');
  v_id       uuid;
BEGIN
  v_plate   := upper(base.req(p, 'truckLicensePlate', 'Truck licence plate', 30));
  v_scac    := upper(base.req(p, 'scacCode', 'SCAC code', 4));
  IF v_scac !~ '^[A-Z]{2,4}$' THEN PERFORM base.bad('SCAC code is 2 to 4 letters', 'scacCode'); END IF;
  v_purpose := base.txt(p, 'purpose');
  IF v_purpose IS NULL OR v_purpose NOT IN ('Live', 'Drop') THEN PERFORM base.bad('Select Live or Drop', 'purpose'); END IF;
  v_vehicle := base.txt(p, 'vehicleType');
  IF v_vehicle IS NULL OR v_vehicle NOT IN ('Tractor', '53" Skirted Trailer', '53" Trailer', 'Box Truck', 'Intermodal Trailer',
                                            'Pup Trailer', 'Refrigerator Trailer', 'Van', 'Garbage BIN', 'Other') THEN
    PERFORM base.bad('Select a vehicle type', 'vehicleType');
  END IF;
  v_reason := base.txt(p, 'visitReason');
  IF v_reason IS NULL OR v_reason NOT IN ('Inbound', 'Outbound', 'Non-Inventory', 'Other') THEN
    PERFORM base.bad('Select a visit reason', 'visitReason');
  END IF;
  IF v_bobtail THEN
    v_trailer := NULL; v_seal := NULL; v_empty := NULL;
  ELSE
    IF v_trailer IS NULL THEN PERFORM base.bad('Trailer No. IN is required unless the driver is a bobtail', 'trailerNoIn'); END IF;
    IF v_empty THEN v_seal := NULL;
    ELSIF v_seal IS NULL THEN PERFORM base.bad('Seal No. is required unless the trailer arrives empty', 'sealNoIn');
    END IF;
  END IF;
  IF NOT gate.flag(p, 'safetyAccepted') THEN PERFORM base.bad('Safety declaration must be acknowledged', 'safetyAccepted'); END IF;

  BEGIN
    INSERT INTO gate.visits (org_id, kind, full_name, phone, purpose, safety_accepted, company, driver_licence, scac,
                             vehicle_type, visit_reason, truck_plate, truck_no, appointment_no, bobtail, trailer_in,
                             arrived_empty, seal_in, arrived_via, arrived_by)
    VALUES (c.org_id, 'driver', base.req(p, 'fullName', 'Driver name'), gate.check_phone(base.req(p, 'phone', 'Phone number', 40)),
            v_purpose, true, base.req(p, 'companyName', 'Company name'), base.req(p, 'driverLicense', 'Driver''s licence', 80),
            v_scac, v_vehicle, v_reason, v_plate, base.req(p, 'truckNumber', 'Truck No.', 40),
            base.req(p, 'appointmentNumber', 'Appointment No.', 60), v_bobtail, v_trailer, v_empty, v_seal, c.name, c.account_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Truck % is already on site', v_plate USING ERRCODE = 'GH409', DETAIL = 'truckLicensePlate';
  END;
  PERFORM base.note(c, 'driver checked in', v_id, jsonb_build_object('plate', v_plate, 'trailer', v_trailer));
  RETURN v_id;
END $$;

-- Reads and locks a visit of the caller's site. Dock coordinators only ever see drivers.
CREATE FUNCTION gate.visit_for_update(c base.caller, p_id uuid) RETURNS gate.visits
LANGUAGE plpgsql SET search_path = pg_catalog, gate AS $$
DECLARE v gate.visits;
BEGIN
  SELECT * INTO v FROM gate.visits WHERE id = p_id AND org_id = c.org_id FOR UPDATE;
  IF v.id IS NULL OR (c.role = 'dock' AND v.kind <> 'driver') THEN
    RAISE EXCEPTION 'Record not found' USING ERRCODE = 'GH404';
  END IF;
  RETURN v;
END $$;

-- Going empty, or trailer and seal OUT: shared by the dock and the gate.
CREATE FUNCTION gate.departure(p jsonb, OUT going_empty boolean, OUT trailer_out text, OUT seal_out text)
LANGUAGE plpgsql SET search_path = pg_catalog, base AS $$
BEGIN
  going_empty := gate.flag(p, 'goingEmpty');
  IF going_empty THEN trailer_out := NULL; seal_out := NULL; RETURN; END IF;
  trailer_out := base.txt(p, 'trailerNoOut');
  seal_out    := base.txt(p, 'sealNoOut');
  IF trailer_out IS NULL THEN PERFORM base.bad('Trailer No. OUT is required when loaded', 'trailerNoOut'); END IF;
  IF seal_out IS NULL THEN PERFORM base.bad('Seal No. OUT is required when loaded', 'sealNoOut'); END IF;
  IF length(trailer_out) > 40 THEN PERFORM base.bad('Trailer No. OUT is too long', 'trailerNoOut'); END IF;
  IF length(seal_out) > 40 THEN PERFORM base.bad('Seal No. OUT is too long', 'sealNoOut'); END IF;
END $$;

CREATE FUNCTION gate.dock_clear(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['dock']); v gate.visits; d record;
BEGIN
  v := gate.visit_for_update(c, p_id);
  IF v.status = 'left' THEN RAISE EXCEPTION 'Driver has already left the site' USING ERRCODE = 'GH409'; END IF;
  IF v.status = 'dock_cleared' THEN RAISE EXCEPTION 'Driver is already cleared at the dock' USING ERRCODE = 'GH409'; END IF;
  d := gate.departure(coalesce(p, '{}'));
  UPDATE gate.visits SET status = 'dock_cleared', going_empty = d.going_empty, trailer_out = d.trailer_out,
         seal_out = d.seal_out, dock_cleared_at = now(), dock_cleared_by = c.name
   WHERE id = p_id;
  PERFORM base.note(c, 'cleared at dock', p_id, jsonb_build_object('goingEmpty', d.going_empty, 'trailer', d.trailer_out, 'seal', d.seal_out));
END $$;

CREATE FUNCTION gate.dock_reopen(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['dock']); v gate.visits;
BEGIN
  v := gate.visit_for_update(c, p_id);
  IF v.status <> 'dock_cleared' THEN
    RAISE EXCEPTION 'Driver is not currently cleared at the dock' USING ERRCODE = 'GH409';
  END IF;
  UPDATE gate.visits SET status = 'on_site', going_empty = NULL, trailer_out = NULL, seal_out = NULL,
         dock_cleared_at = NULL, dock_cleared_by = NULL
   WHERE id = p_id;
  PERFORM base.note(c, 'dock clearance withdrawn', p_id);
END $$;

-- Security lets someone out. Drivers need dock clearance first; the dock's trailer and seal OUT stand unless
-- security corrects them after checking the truck.
CREATE FUNCTION gate.release(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['security']); v gate.visits; d record; merged jsonb;
BEGIN
  v := gate.visit_for_update(c, p_id);
  IF v.status = 'left' THEN RAISE EXCEPTION 'Already checked out' USING ERRCODE = 'GH409'; END IF;
  IF v.kind = 'driver' THEN
    IF v.status <> 'dock_cleared' THEN
      RAISE EXCEPTION 'Dock coordinator approval is required before this driver can leave the gate' USING ERRCODE = 'GH409';
    END IF;
    merged := jsonb_strip_nulls(jsonb_build_object('goingEmpty', v.going_empty, 'trailerNoOut', v.trailer_out, 'sealNoOut', v.seal_out))
              || jsonb_strip_nulls(coalesce(p, '{}'));
    d := gate.departure(merged);
    UPDATE gate.visits SET status = 'left', left_at = now(), released_by = c.name,
           going_empty = d.going_empty, trailer_out = d.trailer_out, seal_out = d.seal_out
     WHERE id = p_id;
    PERFORM base.note(c, 'released at gate', p_id, jsonb_build_object(
      'goingEmpty', d.going_empty, 'trailer', d.trailer_out, 'seal', d.seal_out,
      'correctedDock', d.trailer_out IS DISTINCT FROM v.trailer_out OR d.seal_out IS DISTINCT FROM v.seal_out
                       OR d.going_empty IS DISTINCT FROM v.going_empty));
  ELSE
    UPDATE gate.visits SET status = 'left', left_at = now(), released_by = c.name WHERE id = p_id;
    PERFORM base.note(c, 'checked out', p_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reading: only through row-level security. Kiosks read nothing; dock coordinators see drivers only.
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE gate.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_site ON gate.visits FOR SELECT USING (org_id = (SELECT base.org()));
CREATE POLICY staff_only ON gate.visits AS RESTRICTIVE FOR SELECT
  USING ((SELECT base.role()) IN ('admin', 'security', 'dock'));
CREATE POLICY dock_sees_drivers ON gate.visits AS RESTRICTIVE FOR SELECT
  USING (kind = 'driver' OR (SELECT base.role()) <> 'dock');

GRANT SELECT ON gate.visits TO gatehouse_app;
GRANT EXECUTE ON FUNCTION gate.kiosk_check_in(jsonb), gate.driver_check_in(jsonb), gate.dock_clear(uuid, jsonb),
  gate.dock_reopen(uuid), gate.release(uuid, jsonb) TO gatehouse_app;
