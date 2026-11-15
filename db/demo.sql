-- Demo site with made-up people and trucks (`make demo`). Every name, plate and number here is invented.
-- Loads once: if the demo accounts already exist it stops without changing anything.
\set ON_ERROR_STOP 1
SELECT set_config('demo.pw', :'pw', false) \g /dev/null

DO $$
DECLARE
  o   uuid;
  pw  text := current_setting('demo.pw');
  d0  timestamptz := now() - interval '11 hours';   -- times below are offsets from here, so all are in the past
BEGIN
  IF EXISTS (SELECT 1 FROM base.accounts WHERE username = 'demo-admin') THEN
    RAISE NOTICE 'The demo site is already loaded; nothing changed.';
    RETURN;
  END IF;

  o := base.create_site('Harbourview DC (demo)', 'demo-admin', 'Priya Admin', pw);
  UPDATE base.accounts SET must_change_password = false WHERE org_id = o;
  -- made-up demo site: no authenticator app needed to try it (real sites require two-step for admins by default)
  UPDATE base.site_settings SET require_two_step_admins = false WHERE org_id = o;
  INSERT INTO base.accounts (org_id, username, full_name, role, password_hash, must_change_password) VALUES
    (o, 'demo-security', 'Marcus Gate', 'security', base.hash_password(pw), false),
    (o, 'demo-dock', 'Lena Dock', 'dock', base.hash_password(pw), false);

  -- Visitors and contractors
  INSERT INTO gate.visits (org_id, kind, full_name, email, phone, purpose, host_name, company, insurance_no, id_scanned,
                           safety_accepted, arrived_at, arrived_via)
  VALUES
    (o, 'visitor', 'Owen Park', 'owen.park@example.com', '416-555-0142', 'Quarterly review', 'Priya Admin', NULL, NULL, true, true, d0 + interval '8 hours 12 minutes', 'Kiosk: Front lobby'),
    (o, 'visitor', 'Hana Ito', 'hana.ito@example.com', '647-555-0177', 'Interview', 'Lena Dock', NULL, NULL, false, true, d0 + interval '9 hours 40 minutes', 'Kiosk: Front lobby'),
    (o, 'contractor', 'Rui Costa', 'rui@example.com', '905-555-0110', 'Dock door 4 repair', 'Lena Dock', 'Northline Doors', 'NL-INS-55821', true, true, d0 + interval '7 hours 55 minutes', 'Kiosk: Front lobby'),
    (o, 'contractor', 'Abby Moreau', 'abby@example.com', '905-555-0163', 'Sprinkler inspection', 'Priya Admin', 'Clearwater Fire', 'CW-20931', true, true, d0 + interval '10 hours 5 minutes', 'Kiosk: Front lobby');

  UPDATE gate.visits SET status = 'left', left_at = arrived_at + interval '75 minutes', released_by = 'Marcus Gate'
   WHERE org_id = o AND full_name = 'Owen Park';

  -- Drivers
  INSERT INTO gate.visits (org_id, kind, full_name, phone, purpose, safety_accepted, company, driver_licence, scac,
                           vehicle_type, visit_reason, truck_plate, truck_no, appointment_no, bobtail, trailer_in,
                           arrived_empty, seal_in, arrived_at, arrived_via)
  VALUES
    (o, 'driver', 'Tom Becker', '289-555-0101', 'Live', true, 'Lakeshore Haulage', 'B4410-22817', 'LKSH', '53" Trailer', 'Inbound', 'BX42 719', '118', 'APT-30411', false, 'LKS-5301', false, 'SL-883410', d0 + interval '6 hours 20 minutes', 'Marcus Gate'),
    (o, 'driver', 'Gurpreet Sandhu', '905-555-0122', 'Drop', true, 'Polar Cold Lines', 'S2290-11873', 'PCLX', 'Refrigerator Trailer', 'Inbound', 'CK19 305', '7', 'APT-30415', false, 'PCR-2210', false, 'SL-552091', d0 + interval '7 hours 5 minutes', 'Marcus Gate'),
    (o, 'driver', 'Maria Lopes', '416-555-0133', 'Live', true, 'Trillium Express', 'L7781-09912', 'TRLX', '53" Skirted Trailer', 'Outbound', 'AZ77 120', '204', 'APT-30420', false, 'TRX-8804', true, NULL, d0 + interval '8 hours 30 minutes', 'Marcus Gate'),
    (o, 'driver', 'Kwame Mensah', '647-555-0155', 'Live', true, 'Shield Carriers', 'M5521-77410', 'SHLD', 'Tractor', 'Outbound', 'DF02 884', '31', 'APT-30426', true, NULL, NULL, NULL, d0 + interval '9 hours 15 minutes', 'Marcus Gate'),
    (o, 'driver', 'Elena Petrova', '289-555-0188', 'Drop', true, 'Northern Box Co', 'P6630-44102', 'NBXC', 'Intermodal Trailer', 'Inbound', 'HG55 610', '12', 'APT-30402', false, 'NBX-4410', false, 'SL-771200', d0 - interval '5 hours', 'Marcus Gate'),
    (o, 'driver', 'Sam Okafor', '905-555-0191', 'Live', true, 'Maple Leaf Logistics', 'O1180-55219', 'MLLG', 'Box Truck', 'Non-Inventory', 'JK90 446', '55', 'APT-30399', false, 'MLL-1990', true, NULL, d0 + interval '5 hours 45 minutes', 'Marcus Gate');

  -- Cleared at the dock, waiting at the gate
  UPDATE gate.visits SET status = 'dock_cleared', going_empty = false, trailer_out = 'LKS-5301', seal_out = 'SL-994017',
         dock_cleared_at = arrived_at + interval '2 hours', dock_cleared_by = 'Lena Dock'
   WHERE org_id = o AND truck_plate = 'BX42 719';
  UPDATE gate.visits SET status = 'dock_cleared', going_empty = true,
         dock_cleared_at = arrived_at + interval '40 minutes', dock_cleared_by = 'Lena Dock'
   WHERE org_id = o AND truck_plate = 'DF02 884';
  -- Gone
  UPDATE gate.visits SET status = 'dock_cleared', going_empty = false, trailer_out = 'MLL-1990', seal_out = 'SL-120044',
         dock_cleared_at = arrived_at + interval '90 minutes', dock_cleared_by = 'Lena Dock'
   WHERE org_id = o AND truck_plate = 'JK90 446';
  UPDATE gate.visits SET status = 'left', left_at = dock_cleared_at + interval '15 minutes', released_by = 'Marcus Gate'
   WHERE org_id = o AND truck_plate = 'JK90 446';

  INSERT INTO base.history (org_id, actor, action, subject) VALUES (o, 'Onboarding', 'demo data loaded', o);
END $$;
