BEGIN;

/**
 * P2.10D GOVERNANCE INVARIANT FIX
 * 
 * Root Cause: Artifacts with execution_context_id (governed) could have
 * source='experience_conversation' (legacy), creating inconsistent state.
 * 
 * The P2.5 constraint validated field presence but NOT provenance.
 * Immutability was triggered by execution_context_id IS NOT NULL,
 * regardless of whether the artifact came from a governed RPC.
 * 
 * Fix: Add CHECK constraint requiring governed source when governed.
 */

-- On dispatches: if marked as governed (execution_context_id IS NOT NULL),
-- must come from an authoritative governed RPC, not legacy path
ALTER TABLE public.dispatches
  ADD CONSTRAINT check_dispatch_governance_provenance CHECK (
    execution_context_id IS NULL OR source IN (
      'p25_governed_operating_mission',
      'p29c_governed_operating_mission',
      'p29d_governed_operating_mission'
    )
  );

-- On worker_briefs: implicit (governed briefs only created by RPC)
-- But add comment for clarity
COMMENT ON TABLE public.worker_briefs IS
  'Governed briefs (execution_context_id NOT NULL) must be created via authorized RPC functions, never direct insert';

-- Create a trigger to enforce this at insertion time for extra safety
CREATE FUNCTION public.zeya_validate_dispatch_governance_provenance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.execution_context_id IS NOT NULL THEN
    IF NEW.source NOT IN ('p25_governed_operating_mission', 'p29c_governed_operating_mission', 'p29d_governed_operating_mission') THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='governed dispatch must have authorized source (p25, p29c, or p29d governed path)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER dispatches_validate_governance_provenance BEFORE INSERT OR UPDATE ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public.zeya_validate_dispatch_governance_provenance();

NOTIFY pgrst,'reload schema';
COMMIT;
