-- READ ONLY. One ordered result set for the stopped Preview P2.2 lineage.
-- No RPCs, refreshes, writes, or worker invocation.

WITH params AS (
  SELECT '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid AS working_session_id
), scope AS (
  SELECT working_session.*, onboarding.preparation_status AS website_research_status,
         onboarding.preparation_successful_page_count,
         onboarding.preparation_failed_page_count,
         onboarding.preparation_extraction_version
  FROM public.direct_hire_working_sessions AS working_session
  JOIN params ON params.working_session_id = working_session.id
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = working_session.direct_hire_onboarding_session_id
   AND onboarding.owner_id = working_session.owner_id
   AND onboarding.business_id = working_session.business_id
   AND onboarding.business_representation_id = working_session.business_representation_id
), scoped_evidence AS (
  SELECT evidence.*,
    CASE
      WHEN evidence.registered_public_source_id IS NOT NULL
        THEN 'registered:' || evidence.registered_public_source_id::text
      ELSE 'website:' || coalesce(evidence.canonical_source_url,
                                  evidence.requested_source_url,
                                  evidence.source_authority_key, '')
    END AS website_identity
  FROM public.evidence AS evidence
  JOIN scope
    ON scope.direct_hire_onboarding_session_id = evidence.direct_hire_onboarding_session_id
   AND scope.business_representation_id = evidence.business_representation_id
), latest_website_snapshot AS (
  SELECT DISTINCT ON (website_identity)
         website_identity, source_content_hash, extraction_method_version, source_retrieved_at
  FROM scoped_evidence
  WHERE source_type = 'public_website' AND source_content_hash IS NOT NULL
  ORDER BY website_identity, coalesce(source_retrieved_at, created_at) DESC, created_at DESC
), current_website AS (
  SELECT evidence.*
  FROM scoped_evidence AS evidence
  JOIN latest_website_snapshot AS snapshot
    ON snapshot.website_identity = evidence.website_identity
   AND snapshot.source_content_hash = evidence.source_content_hash
   AND snapshot.extraction_method_version IS NOT DISTINCT FROM evidence.extraction_method_version
   AND snapshot.source_retrieved_at IS NOT DISTINCT FROM evidence.source_retrieved_at
  WHERE evidence.source_type = 'public_website'
), fixed_induction AS (
  SELECT DISTINCT ON (
           evidence.direct_hire_onboarding_session_id,
           coalesce(evidence.captured_by_actor, ''),
           coalesce(evidence.induction_material_type, ''),
           coalesce(evidence.induction_material_label, '')
         ) evidence.*
  FROM scoped_evidence AS evidence
  WHERE evidence.source_type = 'direct_hire_induction'
    AND evidence.induction_material_type = 'description'
    AND evidence.induction_material_label IN ('What the business sells', 'Target customer')
  ORDER BY evidence.direct_hire_onboarding_session_id,
           coalesce(evidence.captured_by_actor, ''),
           coalesce(evidence.induction_material_type, ''),
           coalesce(evidence.induction_material_label, ''),
           evidence.created_at DESC, evidence.id DESC
), effective_evidence AS (
  SELECT evidence.* FROM current_website AS evidence
  UNION ALL
  SELECT evidence.* FROM fixed_induction AS evidence
  UNION ALL
  SELECT evidence.*
  FROM scoped_evidence AS evidence
  WHERE NOT (evidence.source_type = 'public_website' AND evidence.source_content_hash IS NOT NULL)
    AND NOT (evidence.source_type = 'direct_hire_induction' AND evidence.induction_material_type = 'link')
    AND NOT (evidence.source_type = 'direct_hire_induction'
             AND evidence.induction_material_type = 'description'
             AND evidence.induction_material_label IN ('What the business sells', 'Target customer'))
), effective_observations AS (
  SELECT observation.*
  FROM public.observations AS observation
  JOIN effective_evidence AS evidence ON evidence.id = observation.evidence_id
  JOIN scope ON scope.business_representation_id = observation.business_representation_id
), ranked_hypotheses AS (
  SELECT hypothesis.*,
         row_number() OVER (
           PARTITION BY hypothesis.constitutional_domain
           ORDER BY hypothesis.hypothesis_version DESC
         ) AS domain_rank
  FROM public.hypotheses AS hypothesis
  JOIN scope
    ON scope.owner_id = hypothesis.owner_id
   AND scope.business_id = hypothesis.business_id
   AND scope.business_representation_id = hypothesis.business_representation_id
   AND scope.direct_hire_onboarding_session_id = hypothesis.direct_hire_onboarding_session_id
), current_hypotheses AS (
  SELECT * FROM ranked_hypotheses WHERE domain_rank = 1
), fingerprints AS (
  SELECT encode(digest(array_to_string(
           ARRAY['1.1-source-semantics', scope.direct_hire_onboarding_session_id::text,
                 scope.business_representation_id::text]
           || ARRAY(SELECT id::text FROM effective_evidence ORDER BY id)
           || ARRAY(SELECT id::text FROM effective_observations ORDER BY id), '|'), 'sha256'), 'hex') AS reasoning_run_id,
         encode(digest(array_to_string(
           ARRAY(SELECT id::text || ':' || hypothesis_version::text || ':' || coalesce(request_trace_id, '')
                 FROM current_hypotheses ORDER BY id), '|'), 'sha256'), 'hex') AS hypothesis_trace_fingerprint
  FROM scope
), result_rows AS (
  SELECT 10 AS ordinal, 'working_session'::text AS section,
    to_jsonb(scope) - 'owner_id' - 'business_id' - 'business_representation_id' AS details
  FROM scope
  UNION ALL
  SELECT 20, 'recovery_ledger', coalesce(jsonb_agg(to_jsonb(recovery) ORDER BY recovery.recovered_at), '[]'::jsonb)
  FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
  JOIN scope ON scope.id = recovery.direct_hire_working_session_id
  UNION ALL
  SELECT 30, 'current_hypotheses', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'domain', constitutional_domain, 'version', hypothesis_version,
    'epistemicState', epistemic_state, 'confidence', confidence,
    'representationRisk', representation_risk, 'requestTraceId', request_trace_id,
    'currentBelief', current_belief, 'riskReason', risk_reason,
    'previousHypothesisId', previous_hypothesis_id, 'sourceEvidenceIds', source_evidence_ids,
    'createdByActor', created_by_actor, 'createdAt', created_at
  ) ORDER BY constitutional_domain), '[]'::jsonb) FROM current_hypotheses
  UNION ALL
  SELECT 40, 'effective_evidence', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'sourceType', source_type, 'pageType', source_page_type,
    'evidenceKind', source_evidence_kind, 'requestedUrl', requested_source_url,
    'rawStatement', raw_statement, 'affectedDomains', affected_domains,
    'canonicalUrl', canonical_source_url, 'selector', source_selector,
    'contentHash', source_content_hash, 'extractionVersion', extraction_method_version,
    'retrievedAt', source_retrieved_at, 'registeredSourceId', registered_public_source_id,
    'authorityType', source_authority_type, 'authorityKey', source_authority_key,
    'inductionType', induction_material_type, 'inductionLabel', induction_material_label,
    'createdAt', created_at
  )) ORDER BY created_at, id), '[]'::jsonb) FROM effective_evidence
  UNION ALL
  SELECT 50, 'effective_observations', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'evidenceId', evidence_id, 'meaning', interpreted_meaning,
    'confidence', confidence_in_interpretation, 'domains', affected_domains,
    'createdByActor', created_by_actor, 'createdAt', created_at
  ) ORDER BY created_at, id), '[]'::jsonb) FROM effective_observations
  UNION ALL
  SELECT 60, 'brief_history', coalesce(jsonb_agg(jsonb_build_object(
    'id', brief.id, 'current', brief.current, 'contract', brief.preparation_contract_version,
    'sourceSnapshotFingerprint', brief.source_snapshot_fingerprint,
    'hypothesisTraceFingerprint', brief.hypothesis_trace_fingerprint,
    'sourceEvidenceIds', brief.source_evidence_ids,
    'sourceHypothesisIds', brief.source_hypothesis_ids,
    'brief', brief.brief, 'generatedAt', brief.generated_at, 'createdAt', brief.created_at
  ) ORDER BY brief.created_at, brief.id), '[]'::jsonb)
  FROM public.direct_hire_first_working_session_briefs AS brief
  JOIN scope ON scope.id = brief.direct_hire_working_session_id
  UNION ALL
  SELECT 70, 'fingerprints_and_freshness', jsonb_build_object(
    'reasoningRunId', fingerprints.reasoning_run_id,
    'hypothesisTraceFingerprint', fingerprints.hypothesis_trace_fingerprint,
    'hypothesesFresh', (SELECT count(*) = 7 AND bool_and(request_trace_id = fingerprints.reasoning_run_id) FROM current_hypotheses),
    'effectiveEvidenceCount', (SELECT count(*) FROM effective_evidence),
    'effectiveObservationCount', (SELECT count(*) FROM effective_observations),
    'currentHypothesisCount', (SELECT count(*) FROM current_hypotheses),
    'currentBriefCount', (SELECT count(*) FROM public.direct_hire_first_working_session_briefs AS brief JOIN scope ON scope.id = brief.direct_hire_working_session_id WHERE brief.current),
    'historicalEvidenceCount', (SELECT count(*) FROM scoped_evidence) - (SELECT count(*) FROM effective_evidence)
  ) FROM fingerprints
)
SELECT ordinal, section, details
FROM result_rows
ORDER BY ordinal;
