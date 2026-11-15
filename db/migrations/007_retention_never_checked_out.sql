-- 007: visitors and drivers nobody checked out kept their photo and personal details forever, and an
-- admin could not erase them. The retention clock now runs from when someone left, or, if they were never checked out,
-- from when they arrived. An admin can erase a visit that has left, or one that arrived more than a day ago.
-- Erasing or removing a photo never changes anything else on the visit (status, times, truck, trailer, seals).
SET LOCAL ROLE gatehouse_owner;

ALTER TABLE gate.visits DROP CONSTRAINT erased_only_after_leaving;

CREATE OR REPLACE FUNCTION gate.guard_visit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, gate AS $$
DECLARE same_business boolean;
BEGIN
  same_business :=
    (OLD.org_id, OLD.kind, OLD.status, OLD.purpose, OLD.safety_accepted, OLD.company, OLD.host_name, OLD.id_scanned,
     OLD.scac, OLD.vehicle_type, OLD.visit_reason, OLD.truck_plate, OLD.truck_no, OLD.appointment_no, OLD.bobtail,
     OLD.trailer_in, OLD.arrived_empty, OLD.seal_in, OLD.going_empty, OLD.trailer_out, OLD.seal_out, OLD.arrived_at,
     OLD.arrived_via, OLD.arrived_by, OLD.dock_cleared_at, OLD.dock_cleared_by, OLD.left_at, OLD.released_by)
    IS NOT DISTINCT FROM
    (NEW.org_id, NEW.kind, NEW.status, NEW.purpose, NEW.safety_accepted, NEW.company, NEW.host_name, NEW.id_scanned,
     NEW.scac, NEW.vehicle_type, NEW.visit_reason, NEW.truck_plate, NEW.truck_no, NEW.appointment_no, NEW.bobtail,
     NEW.trailer_in, NEW.arrived_empty, NEW.seal_in, NEW.going_empty, NEW.trailer_out, NEW.seal_out, NEW.arrived_at,
     NEW.arrived_via, NEW.arrived_by, NEW.dock_cleared_at, NEW.dock_cleared_by, NEW.left_at, NEW.released_by);

  IF same_business THEN
    -- photo removal only (any status)
    IF OLD.photo IS NOT NULL AND NEW.photo IS NULL AND NEW.redacted_at IS NOT DISTINCT FROM OLD.redacted_at
       AND (NEW.full_name, NEW.phone, NEW.email, NEW.insurance_no, NEW.driver_licence)
           IS NOT DISTINCT FROM (OLD.full_name, OLD.phone, OLD.email, OLD.insurance_no, OLD.driver_licence) THEN
      RETURN NEW;
    END IF;
    -- erasure of every personal detail at once (any status)
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.full_name = 'Removed' AND NEW.photo IS NULL
       AND NEW.phone IS NULL AND NEW.email IS NULL AND NEW.insurance_no IS NULL AND NEW.driver_licence IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF OLD.status = 'left' THEN
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

-- The clock: when they left, or when they arrived if nobody checked them out.
CREATE OR REPLACE FUNCTION gate.apply_retention() RETURNS TABLE (site uuid, photos int, erased int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
#variable_conflict use_column
DECLARE s record; p int; e int;
BEGIN
  FOR s IN SELECT org_id, keep_photo_days, keep_personal_days FROM base.site_settings LOOP
    UPDATE gate.visits SET photo = NULL
     WHERE org_id = s.org_id AND photo IS NOT NULL
       AND coalesce(left_at, arrived_at) < now() - make_interval(days => s.keep_photo_days);
    GET DIAGNOSTICS p = ROW_COUNT;
    UPDATE gate.visits SET redacted_at = now(), full_name = 'Removed', photo = NULL, phone = NULL, email = NULL,
           insurance_no = NULL, driver_licence = NULL
     WHERE org_id = s.org_id AND redacted_at IS NULL
       AND coalesce(left_at, arrived_at) < now() - make_interval(days => s.keep_personal_days);
    GET DIAGNOSTICS e = ROW_COUNT;
    IF p + e > 0 THEN
      INSERT INTO base.history (org_id, actor, action, subject, detail)
      VALUES (s.org_id, 'Retention', 'removed expired personal data', s.org_id, jsonb_build_object('photos', p, 'visits', e));
      RETURN QUERY SELECT s.org_id, p, e;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION gate.erase_visit(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base, gate AS $$
DECLARE c base.caller := base.need(ARRAY['admin']); v gate.visits;
BEGIN
  SELECT * INTO v FROM gate.visits WHERE id = p_id AND org_id = c.org_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE = 'GH404'; END IF;
  IF v.status <> 'left' AND v.arrived_at > now() - interval '1 day' THEN
    RAISE EXCEPTION 'They may still be on site: check them out first, or wait a day if they left without checking out' USING ERRCODE = 'GH409';
  END IF;
  IF v.redacted_at IS NOT NULL THEN RAISE EXCEPTION 'Already erased' USING ERRCODE = 'GH409'; END IF;
  UPDATE gate.visits SET redacted_at = now(), full_name = 'Removed', photo = NULL, phone = NULL, email = NULL,
         insurance_no = NULL, driver_licence = NULL
   WHERE id = p_id;
  PERFORM base.note(c, 'erased personal details', p_id);
END $$;
