BEGIN;

-- P2.12B: Replace zeya_claim_first_working_session_preparation to support
-- session-targeted claims while preserving queue-worker behavior.
--
-- SIGNATURE MIGRATION SEQUENCE:
-- Old signature: zeya_claim_first_working_session_preparation(text, integer)
-- New signature: zeya_claim_first_working_session_preparation(text, integer, uuid DEFAULT NULL)
--
-- These are different PostgreSQL function signatures (different arity).
-- Safe migration requires DROP old signature + CREATE new signature.
-- This ensures exactly one function signature exists (no ambiguous overloads).
--
-- MIGRATION STRATEGY:
-- 1. Drop the old 2-argument function (signature is definitive)
-- 2. Create the new 3-argument function with all security settings
-- 3. Restore SECURITY DEFINER, search_path, ownership, grants
-- 4. Verify exactly one signature exists via pg_proc query
--
-- BACKWARD COMPATIBILITY:
-- The new function has a DEFAULT value for the third parameter, so:
-- - Old calls: rpc("zeya_claim_first_working_session_preparation", {p_contract_version: "...", p_lease_seconds: 600})
--   → uses DEFAULT NULL for p_working_session_id ✓
-- - New calls: rpc("zeya_claim_first_working_session_preparation", {p_contract_version: "...", p_lease_seconds: 600, p_working_session_id: "..."})
--   → provides explicit p_working_session_id ✓
-- PostgREST RPC can resolve both patterns to the single function signature.

-- Drop old 2-argument function signature to avoid ambiguous overloads
DROP FUNCTION IF EXISTS public.zeya_claim_first_working_session_preparation(text, integer) CASCADE;

-- Create new 3-argument function with session targeting support
CREATE FUNCTION public.zeya_claim_first_working_session_preparation(
  p_contract_version text,
  p_lease_seconds integer DEFAULT 300,
  p_working_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  working_session_id uuid, onboarding_session_id uuid, owner_id uuid,
  business_id uuid, business_representation_id uuid, website_url text,
  lease_id uuid, attempt_count smallint, website_persisted boolean, claimed boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_lease_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_contract_version IS NULL OR btrim(p_contract_version) = ''
     OR p_lease_seconds NOT BETWEEN 60 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation claim';
  END IF;

  SELECT candidate.* INTO v_session
  FROM public.direct_hire_working_sessions AS candidate
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = candidate.direct_hire_onboarding_session_id
   AND onboarding.owner_id = candidate.owner_id
   AND onboarding.business_id = candidate.business_id
   AND onboarding.business_representation_id = candidate.business_representation_id
  WHERE candidate.status = 'scheduled'
    AND onboarding.onboarding_state = 'employment_accepted'
    AND onboarding.induction_state = 'preparation_pending'
    AND candidate.preparation_attempt_count < 3
    AND (
      candidate.preparation_status IN ('pending', 'failed')
      OR (candidate.preparation_status = 'running' AND candidate.preparation_lease_expires_at <= now())
      OR (candidate.preparation_status = 'ready' AND candidate.preparation_contract_version IS DISTINCT FROM p_contract_version)
    )
    AND (p_working_session_id IS NULL OR candidate.id = p_working_session_id)
  ORDER BY candidate.scheduled_at, candidate.created_at
  LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED;

  IF v_session.id IS NULL THEN RETURN; END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
  FOR UPDATE;

  v_lease_id := gen_random_uuid();
  IF v_session.preparation_status='ready'
    AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version THEN
    UPDATE public.direct_hire_first_working_session_briefs AS brief
    SET current=false
    WHERE brief.direct_hire_working_session_id=v_session.id AND brief.current;
  END IF;
  UPDATE public.direct_hire_working_sessions AS working_session
  SET preparation_status = 'running',
      preparation_started_at = now(), preparation_completed_at = NULL,
      preparation_failure_code = NULL, preparation_lease_id = v_lease_id,
      preparation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      preparation_contract_version = p_contract_version,
      preparation_website_persisted_at = CASE
        WHEN v_session.preparation_status='ready'
          AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version
        THEN NULL ELSE v_session.preparation_website_persisted_at END
  WHERE working_session.id = v_session.id;

  RETURN QUERY SELECT v_session.id, v_onboarding.id, v_session.owner_id,
    v_session.business_id, v_session.business_representation_id, v_onboarding.website_url,
    v_lease_id, v_session.preparation_attempt_count,
    v_session.preparation_website_persisted_at IS NOT NULL
      AND NOT (v_session.preparation_status='ready'
        AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version),
    true;
END;
$$;

ALTER FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid) TO service_role;

-- VERIFICATION: Ensure exactly one function signature exists
-- This query must return exactly one row with the new 3-argument signature
DO $$
DECLARE
  v_count integer;
  v_signature text;
BEGIN
  SELECT count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), '; ')
  INTO v_count, v_signature
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_claim_first_working_session_preparation';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Function signature migration failed: expected 1 signature, found %', v_count;
  END IF;

  IF v_signature NOT LIKE '%uuid%' THEN
    RAISE EXCEPTION 'Function signature migration failed: expected uuid parameter, got %', v_signature;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
