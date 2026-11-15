-- 006: 005 added columns to base.site_settings, which broke base.default_settings() (it returns a whole row), so no
-- new site could be created. Same defaults, with the new columns. Caught by db/tests/rules.sql.
SET LOCAL ROLE gatehouse_owner;

CREATE OR REPLACE FUNCTION base.default_settings() RETURNS base.site_settings
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, base AS $$
  SELECT NULL::uuid,
    ARRAY['Stay with your host and on marked walkways at all times.',
          'Wear the high-visibility vest and any protective equipment you are given.',
          'Forklifts and trucks have right of way. Never walk behind a reversing vehicle.',
          'In an alarm, leave by the nearest exit and go to the assembly point. Do not use the dock doors.',
          'Report any injury or near miss to your host straight away.'],
    'Stay in or beside the cab unless told otherwise, wear a high-visibility vest outside the cab, chock wheels at the dock, and follow the dock lights.',
    NULL::text, now(), NULL::text,
    true, 30, 365
$$;
