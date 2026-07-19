-- Additive runtime correction: SECURITY DEFINER search_path is intentionally empty,
-- so enum literals in the already-deployed orchestration body must be schema-qualified.
BEGIN;
DO $correction$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure)
    INTO definition;
  definition := replace(definition,
    'proposal.status IN (''rejected'',''superseded'')',
    'proposal.status IN (''rejected''::public.proposal_status,''superseded''::public.proposal_status)');
  definition := replace(definition,
    'proposal.status NOT IN (''pending_approval'',''approved'')',
    'proposal.status NOT IN (''pending_approval''::public.proposal_status,''approved''::public.proposal_status)');
  definition := replace(definition,
    'approval.decision<>''approved''',
    'approval.decision<>''approved''::public.approval_decision_type');
  definition := replace(definition,
    'proposal.status=''pending_approval'' THEN UPDATE public.representation_proposals SET status=''approved'',status_updated_at=now() WHERE id=proposal.id AND status=''pending_approval''',
    'proposal.status=''pending_approval''::public.proposal_status THEN UPDATE public.representation_proposals SET status=''approved''::public.proposal_status,status_updated_at=now() WHERE id=proposal.id AND status=''pending_approval''::public.proposal_status');
  EXECUTE definition;
END;
$correction$;
ALTER FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
