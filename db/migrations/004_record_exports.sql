-- 004: a full-site export is written to the history (who took a copy of the site's data, and when).
SET LOCAL ROLE gatehouse_owner;

CREATE FUNCTION base.record_export() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, base AS $$
DECLARE c base.caller := base.need(ARRAY['admin']);
BEGIN
  PERFORM base.note(c, 'exported all site data', c.org_id);
END $$;

GRANT EXECUTE ON FUNCTION base.record_export() TO gatehouse_app;
