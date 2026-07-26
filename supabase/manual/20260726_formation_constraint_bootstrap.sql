BEGIN;

-- Purpose: make the production Formation uniqueness constraint compatible
-- with 20260726000000 without dropping or rebuilding uniqueness protection.
--
-- PRE-EXECUTION VERIFICATION (read-only):
-- SELECT business_representation_id, count(*)
-- FROM public.representation_formation_sessions
-- GROUP BY business_representation_id HAVING count(*) > 1;
--
-- SELECT con.conname, con.contype, pg_get_constraintdef(con.oid),
--        idx.relname AS backing_index
-- FROM pg_constraint con
-- JOIN pg_class tbl ON tbl.oid = con.conrelid
-- JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
-- LEFT JOIN pg_class idx ON idx.oid = con.conindid
-- WHERE ns.nspname = 'public'
--   AND tbl.relname = 'representation_formation_sessions'
--   AND con.contype = 'u';

-- Prevent concurrent inserts/updates while duplicate and catalog preconditions
-- are checked. Existing uniqueness protection remains installed throughout.
LOCK TABLE public.representation_formation_sessions
  IN SHARE ROW EXCLUSIVE MODE;

DO $bootstrap$
DECLARE
  v_business_representation_attnum smallint;
  v_target_oid oid;
  v_target_definition text;
  v_source_name name;
  v_source_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.representation_formation_sessions
    GROUP BY business_representation_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'bootstrap refused: duplicate Formation sessions exist';
  END IF;

  SELECT attnum
  INTO v_business_representation_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.representation_formation_sessions'::regclass
    AND attname = 'business_representation_id'
    AND NOT attisdropped;

  IF v_business_representation_attnum IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42703',
      MESSAGE = 'bootstrap refused: business_representation_id is absent';
  END IF;

  SELECT con.oid, pg_get_constraintdef(con.oid)
  INTO v_target_oid, v_target_definition
  FROM pg_constraint AS con
  WHERE con.conrelid = 'public.representation_formation_sessions'::regclass
    AND con.conname = 'formation_session_representation_uniq';

  IF v_target_oid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS con
      JOIN pg_index AS ind ON ind.indexrelid = con.conindid
      WHERE con.oid = v_target_oid
        AND con.contype = 'u'
        AND ind.indisunique
        AND ind.indisvalid
        AND ind.indisready
        AND ind.indpred IS NULL
        AND ind.indexprs IS NULL
        AND ind.indnkeyatts = 1
        AND ind.indnatts = 1
        AND ind.indkey[0] = v_business_representation_attnum
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'bootstrap refused: target constraint name has unexpected structure',
        DETAIL = v_target_definition;
    END IF;

    -- Already normalized with the exact required structure.
    RETURN;
  END IF;

  SELECT count(*), min(con.conname::text)::name
  INTO v_source_count, v_source_name
  FROM pg_constraint AS con
  JOIN pg_index AS ind ON ind.indexrelid = con.conindid
  WHERE con.conrelid = 'public.representation_formation_sessions'::regclass
    AND con.contype = 'u'
    AND ind.indisunique
    AND ind.indisvalid
    AND ind.indisready
    AND ind.indpred IS NULL
    AND ind.indexprs IS NULL
    AND ind.indnkeyatts = 1
    AND ind.indnatts = 1
    AND ind.indkey[0] = v_business_representation_attnum;

  IF v_source_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'bootstrap refused: expected exactly one structural Formation uniqueness constraint',
      DETAIL = format('matching constraints: %s', v_source_count);
  END IF;

  EXECUTE format(
    'ALTER TABLE public.representation_formation_sessions RENAME CONSTRAINT %I TO formation_session_representation_uniq',
    v_source_name
  );
END;
$bootstrap$;

-- POST-EXECUTION VERIFICATION (must return one row with the target name,
-- a UNIQUE definition on business_representation_id, and a valid unique index):
-- SELECT con.conname, pg_get_constraintdef(con.oid),
--        idx.relname AS backing_index, ind.indisunique, ind.indisvalid,
--        ind.indisready
-- FROM pg_constraint con
-- JOIN pg_class idx ON idx.oid = con.conindid
-- JOIN pg_index ind ON ind.indexrelid = con.conindid
-- WHERE con.conrelid =
--       'public.representation_formation_sessions'::regclass
--   AND con.conname = 'formation_session_representation_uniq';

COMMIT;
