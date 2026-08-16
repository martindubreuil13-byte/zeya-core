-- READ ONLY. Run only after the reviewed P2.3D migration and one proposal-generation request.
WITH target AS (SELECT '667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid formation_id), proposal AS (
 SELECT p.*,o.outcome FROM target t JOIN public.representation_proposals p ON p.formation_session_id=t.formation_id
 JOIN public.direct_hire_formation_outcome_packages o ON o.id=p.source_formation_outcome_package_id
 WHERE p.proposal_contract_version='direct-hire-formation-proposal-v1'
) SELECT id,status,requires_approval,canonicalization_intent,source_state_fingerprint,
 jsonb_object_keys(proposed_changes->'elementUpdates') proposed_domain,
 status='pending_approval' AND requires_approval AND canonicalization_intent='initial_canonicalization'
 AND source_state_fingerprint~'^[0-9a-f]{64}$'
 AND jsonb_object_length(proposed_changes->'elementUpdates')>0
 AND NOT (proposed_changes->'elementUpdates' ?| ARRAY['authorityBoundaries','authority_negotiation','authority_meeting_booking','authority_escalation_rules']) AS proposal_pass
FROM proposal;

WITH target AS (SELECT '667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid formation_id)
SELECT count(*) FILTER(WHERE p.proposal_contract_version='direct-hire-formation-proposal-v1')=1 AS exactly_one_proposal,
 count(DISTINCT v.id)=0 AS no_version,r.current_version_id IS NULL AS no_canonical_pointer,
 f.first_working_conversation_id IS NULL AS no_voice_link,count(DISTINCT voice.id)=0 AS no_voice_output
FROM target t JOIN public.representation_formation_sessions f ON f.id=t.formation_id
JOIN public.business_representations r ON r.id=f.business_representation_id
LEFT JOIN public.representation_proposals p ON p.formation_session_id=f.id
LEFT JOIN public.representation_versions v ON v.business_representation_id=r.id
LEFT JOIN public.voice_conversation_outputs voice ON voice.business_representation_id=r.id
GROUP BY r.current_version_id,f.first_working_conversation_id;
