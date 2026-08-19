-- READ ONLY. Stage B postcheck after explicit approval and one controlled execute request.
-- Stranded claim = status='claimed' + authorization='consumed' = uncertain, requires manual review.
SELECT e.id,e.authorization_id,e.dispatch_id,e.worker_brief_id,e.status,e.provider,e.provider_call_id,e.conversation_id,e.error_code,
  e.claimed_at,e.started_at,e.completed_at,a.status AS authorization_status,a.consumed_at,
  CASE
    WHEN e.status='claimed' AND a.status='consumed' THEN 'manual_review_uncertain_stranded'
    WHEN e.status='dispatched' THEN 'provider_accepted'
    WHEN e.status='failed' THEN 'provider_rejected'
    ELSE 'unexpected_state'
  END AS execution_disposition,
  (SELECT count(*) FROM public.governed_execution_attempts x WHERE x.authorization_id=a.id) attempt_count,
  (SELECT count(*) FROM public.voice_representation_lineage x WHERE x.worker_brief_id=e.worker_brief_id) voice_lineage_count,
  (SELECT count(*) FROM public.voice_conversation_outputs x WHERE x.worker_brief_id=e.worker_brief_id) voice_output_count
FROM public.governed_execution_attempts e JOIN public.governed_execution_authorizations a ON a.id=e.authorization_id
WHERE e.dispatch_id='p25_dispatch_4c1cb79b0e2644c8970192131646f4e0';
