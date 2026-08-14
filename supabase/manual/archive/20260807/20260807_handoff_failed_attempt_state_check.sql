-- Direct Hire Formation Handoff - Failed Attempt State Check
-- After live Preview compilation failed, verify what objects were partially created
-- This check determines whether rollback was automatic and what cleanup may be needed
-- Strictly read-only inspection using catalogs. One row result.

SELECT
  -- Enum value presence (from 20260807000000, should persist even if 20260807010000 failed)
  EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'direct_hire_onboarding'
      AND enumtypid = 'public.formation_initiation_source'::regtype
  ) AS direct_hire_enum_present,

  -- Handoff columns added to direct_hire_onboarding_sessions (should be absent if rollback succeeded)
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'direct_hire_onboarding_sessions'
      AND column_name = 'formation_session_id'
  ) AS formation_session_id_column_present,

  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'direct_hire_onboarding_sessions'
      AND column_name = 'formation_initiated_at'
  ) AS formation_initiated_at_column_present,

  -- Handoff index (should be absent if rollback succeeded)
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'direct_hire_onboarding_sessions'
      AND indexname = 'direct_hire_formation_session_idx'
  ) AS handoff_index_present,

  -- Handoff RPC (should be absent if rollback succeeded)
  to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NOT NULL AS handoff_rpc_present,

  -- RPC service-role-only ACL (only if RPC present)
  COALESCE(
    CASE
      WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NOT NULL THEN
        (
          NOT has_function_privilege('PUBLIC'::text, to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'), 'EXECUTE')
          AND NOT has_function_privilege('anon'::text, to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'), 'EXECUTE')
          AND NOT has_function_privilege('authenticated'::text, to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'), 'EXECUTE')
          AND has_function_privilege('service_role'::text, to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'), 'EXECUTE')
        )
      ELSE NULL
    END,
    NULL
  )::boolean AS rpc_service_role_only_if_present,

  -- Rollback verdict: all handoff objects absent means automatic rollback succeeded
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'direct_hire_onboarding_sessions'
      AND column_name IN ('formation_session_id', 'formation_initiated_at')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'direct_hire_onboarding_sessions'
      AND indexname = 'direct_hire_formation_session_idx'
  )
  AND to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL
  AS migration_rolled_back_completely;
