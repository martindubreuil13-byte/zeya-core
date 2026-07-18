-- Rollback: Canonical Version pointer atomicity.
-- Removes only the undeployed-package RPC. Existing data, composite pointer FK,
-- shared immutable triggers, and canonical Version history are preserved.

BEGIN;

DO $$
DECLARE
  function_row pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT p.*
  INTO function_row
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure(
    'public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)'
  );

  IF function_row.oid IS NULL THEN
    RAISE NOTICE 'zeya_create_canonical_version_atomic does not exist; nothing to remove';
    RETURN;
  END IF;

  IF pg_catalog.pg_get_userbyid(function_row.proowner) <> 'postgres'
     OR NOT function_row.prosecdef
     OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR pg_catalog.regexp_replace(function_row.prosrc, '[[:space:]]+', '', 'g')
          !~* 'frompublic\.business_representations.*forupdate'
     OR pg_catalog.regexp_replace(function_row.prosrc, '[[:space:]]+', '', 'g')
          !~* 'insertintopublic\.representation_versions'
     OR pg_catalog.regexp_replace(function_row.prosrc, '[[:space:]]+', '', 'g')
          !~* 'setcurrent_version_id=v_new_version_id'
  THEN
    RAISE EXCEPTION 'atomic canonical Version RPC drifted; refusing rollback';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.zeya_create_canonical_version_atomic(
  UUID, UUID, UUID, JSONB, SMALLINT, UUID, UUID
);

NOTIFY pgrst, 'reload schema';

COMMIT;
