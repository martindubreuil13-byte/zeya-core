-- P2.2 Preview live-quality inspection (STRICTLY READ-ONLY).
-- Run with the service role in the intended Preview project only.
-- The QA identity is bound by email; every inspected row is then reached through
-- the selected working-session/onboarding/Representation lineage.
--
-- Output is one human-readable result set. Order by section, then item_order.
-- If TARGET RESOLUTION does not report exactly one candidate, all tenant data
-- sections remain empty rather than selecting an arbitrary owner.

WITH
qa_identity AS (
  SELECT users.id AS owner_id, users.email
  FROM auth.users AS users
  WHERE lower(users.email) = lower('mdubreu@gmail.com')
),
candidate_lineage AS (
  SELECT
    working_session.*,
    onboarding.website_url,
    onboarding.preparation_successful_page_count AS legacy_successful_page_count,
    onboarding.preparation_failed_page_count AS legacy_failed_page_count,
    onboarding.preparation_extraction_version AS legacy_extraction_version,
    count(*) OVER () AS candidate_count
  FROM qa_identity AS qa
  JOIN public.direct_hire_working_sessions AS working_session
    ON working_session.owner_id = qa.owner_id
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = working_session.direct_hire_onboarding_session_id
   AND onboarding.owner_id = working_session.owner_id
   AND onboarding.business_id = working_session.business_id
   AND onboarding.business_representation_id = working_session.business_representation_id
  WHERE working_session.session_kind = 'first_working_session'
    AND working_session.status = 'scheduled'
    AND working_session.preparation_status = 'ready'
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v1'
    AND EXISTS (
      SELECT 1
      FROM public.direct_hire_first_working_session_briefs AS current_brief
      WHERE current_brief.direct_hire_working_session_id = working_session.id
        AND current_brief.current
    )
),
target AS (
  SELECT *
  FROM candidate_lineage
  WHERE candidate_count = 1
),
scoped_evidence AS (
  SELECT evidence.*
  FROM target
  JOIN public.evidence AS evidence
    ON evidence.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
   AND evidence.business_representation_id = target.business_representation_id
),
latest_website_page AS (
  SELECT DISTINCT ON (logical_page_key)
    logical_page_key,
    source_content_hash,
    extraction_method_version,
    source_retrieved_at,
    created_at
  FROM (
    SELECT
      evidence.*,
      CASE
        WHEN evidence.registered_public_source_id IS NOT NULL
          THEN 'registered:' || evidence.registered_public_source_id::text
        ELSE 'website:' || coalesce(
          evidence.canonical_source_url,
          evidence.requested_source_url,
          evidence.source_authority_key,
          evidence.id::text
        )
      END AS logical_page_key
    FROM scoped_evidence AS evidence
    WHERE evidence.source_type = 'public_website'
      AND evidence.source_content_hash IS NOT NULL
  ) AS website_history
  ORDER BY logical_page_key,
    coalesce(source_retrieved_at, created_at) DESC,
    created_at DESC,
    source_content_hash DESC
),
effective_website_evidence AS (
  SELECT
    evidence.*,
    CASE
      WHEN evidence.registered_public_source_id IS NOT NULL
        THEN 'registered:' || evidence.registered_public_source_id::text
      ELSE 'website:' || coalesce(
        evidence.canonical_source_url,
        evidence.requested_source_url,
        evidence.source_authority_key,
        evidence.id::text
      )
    END AS page_snapshot_key
  FROM scoped_evidence AS evidence
  JOIN latest_website_page AS latest
    ON latest.logical_page_key = CASE
      WHEN evidence.registered_public_source_id IS NOT NULL
        THEN 'registered:' || evidence.registered_public_source_id::text
      ELSE 'website:' || coalesce(
        evidence.canonical_source_url,
        evidence.requested_source_url,
        evidence.source_authority_key,
        evidence.id::text
      )
    END
   AND latest.source_content_hash = evidence.source_content_hash
   AND latest.extraction_method_version IS NOT DISTINCT FROM evidence.extraction_method_version
   AND latest.source_retrieved_at IS NOT DISTINCT FROM evidence.source_retrieved_at
  WHERE evidence.source_type = 'public_website'
),
latest_fixed_induction AS (
  SELECT DISTINCT ON (
    evidence.direct_hire_onboarding_session_id,
    coalesce(evidence.captured_by_actor, ''),
    evidence.induction_material_type,
    evidence.induction_material_label
  ) evidence.*
  FROM scoped_evidence AS evidence
  WHERE evidence.source_type = 'direct_hire_induction'
    AND evidence.induction_material_type = 'description'
    AND evidence.induction_material_label IN ('What the business sells', 'Target customer')
  ORDER BY
    evidence.direct_hire_onboarding_session_id,
    coalesce(evidence.captured_by_actor, ''),
    evidence.induction_material_type,
    evidence.induction_material_label,
    evidence.created_at DESC,
    evidence.id DESC
),
effective_nonwebsite_evidence AS (
  SELECT evidence.*
  FROM scoped_evidence AS evidence
  WHERE evidence.source_type <> 'public_website'
    AND NOT (
      evidence.source_type = 'direct_hire_induction'
      AND evidence.induction_material_type = 'link'
    )
    AND NOT (
      evidence.source_type = 'direct_hire_induction'
      AND evidence.induction_material_type = 'description'
      AND evidence.induction_material_label IN ('What the business sells', 'Target customer')
    )
  UNION ALL
  SELECT fixed.* FROM latest_fixed_induction AS fixed
),
effective_evidence AS (
  SELECT website.* FROM effective_website_evidence AS website
  UNION ALL
  SELECT nonwebsite.*, NULL::text AS page_snapshot_key
  FROM effective_nonwebsite_evidence AS nonwebsite
),
effective_observations AS (
  SELECT observation.*
  FROM target
  JOIN public.observations AS observation
    ON observation.business_representation_id = target.business_representation_id
  JOIN effective_evidence AS evidence ON evidence.id = observation.evidence_id
),
hypothesis_history AS (
  SELECT hypothesis.*,
    row_number() OVER (
      PARTITION BY hypothesis.constitutional_domain
      ORDER BY hypothesis.hypothesis_version DESC, hypothesis.created_at DESC, hypothesis.id DESC
    ) AS current_rank
  FROM target
  JOIN public.hypotheses AS hypothesis
    ON hypothesis.owner_id = target.owner_id
   AND hypothesis.business_id = target.business_id
   AND hypothesis.business_representation_id = target.business_representation_id
   AND hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
),
current_hypotheses AS (
  SELECT history.*
  FROM hypothesis_history AS history
  WHERE history.current_rank = 1
),
brief_history AS (
  SELECT brief.*
  FROM target
  JOIN public.direct_hire_first_working_session_briefs AS brief
    ON brief.direct_hire_working_session_id = target.id
   AND brief.owner_id = target.owner_id
   AND brief.business_id = target.business_id
   AND brief.business_representation_id = target.business_representation_id
   AND brief.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
),
current_briefs AS (
  SELECT brief.* FROM brief_history AS brief WHERE brief.current
),
reasoning_fingerprint AS (
  SELECT encode(extensions.digest(array_to_string(
    ARRAY[
      '1.1-source-semantics',
      target.direct_hire_onboarding_session_id::text,
      target.business_representation_id::text
    ]
    || coalesce((SELECT array_agg(evidence.id::text ORDER BY evidence.id) FROM effective_evidence AS evidence), ARRAY[]::text[])
    || coalesce((SELECT array_agg(observation.id::text ORDER BY observation.id) FROM effective_observations AS observation), ARRAY[]::text[]),
    '|'
  ), 'sha256'), 'hex') AS fingerprint
  FROM target
),
hypothesis_fingerprint AS (
  SELECT encode(extensions.digest(coalesce(string_agg(
    hypothesis.id::text || ':' || hypothesis.hypothesis_version::text || ':' || coalesce(hypothesis.request_trace_id, ''),
    '|' ORDER BY hypothesis.id::text || ':' || hypothesis.hypothesis_version::text || ':' || coalesce(hypothesis.request_trace_id, '')
  ), ''), 'sha256'), 'hex') AS fingerprint
  FROM current_hypotheses AS hypothesis
),
expected_brief_snapshot AS (
  SELECT encode(extensions.digest(array_to_string(
    ARRAY[
      'first-working-session-preparation-v1',
      reasoning.fingerprint,
      hypothesis_trace.fingerprint
    ]
    || coalesce((SELECT array_agg(supplied.source_id::text ORDER BY supplied.source_id) FROM current_briefs, unnest(current_briefs.source_evidence_ids) AS supplied(source_id)), ARRAY[]::text[])
    || coalesce((SELECT array_agg(supplied.source_id::text ORDER BY supplied.source_id) FROM current_briefs, unnest(current_briefs.source_hypothesis_ids) AS supplied(source_id)), ARRAY[]::text[]),
    '|'
  ), 'sha256'), 'hex') AS fingerprint
  FROM reasoning_fingerprint AS reasoning
  CROSS JOIN hypothesis_fingerprint AS hypothesis_trace
),
website_pages AS (
  SELECT
    evidence.page_snapshot_key,
    coalesce(evidence.canonical_source_url, evidence.requested_source_url) AS canonical_or_final_url,
    evidence.requested_source_url,
    evidence.source_page_type,
    evidence.source_authority_key,
    evidence.source_authority_type,
    evidence.source_content_hash,
    evidence.extraction_method_version,
    min(evidence.source_retrieved_at) AS retrieved_at,
    count(*) AS evidence_artifact_count
  FROM effective_website_evidence AS evidence
  GROUP BY evidence.page_snapshot_key,
    coalesce(evidence.canonical_source_url, evidence.requested_source_url),
    evidence.requested_source_url,
    evidence.source_page_type,
    evidence.source_authority_key,
    evidence.source_authority_type,
    evidence.source_content_hash,
    evidence.extraction_method_version
),
quality_counts AS (
  SELECT
    (SELECT count(*) FROM website_pages WHERE source_page_type <> 'registered_public_page') AS effective_company_website_pages,
    (SELECT count(DISTINCT CASE
      WHEN evidence.source_type = 'public_website' THEN
        CASE WHEN evidence.registered_public_source_id IS NOT NULL
          THEN 'registered-source:' || evidence.registered_public_source_id::text
          ELSE 'webpage:' || coalesce(evidence.canonical_source_url, evidence.requested_source_url, evidence.source_content_hash, evidence.id::text)
        END
      WHEN evidence.source_type = 'direct_hire_induction' THEN 'owner-origin:' || evidence.id::text
      ELSE 'artifact-origin:' || evidence.id::text
    END) FROM effective_evidence AS evidence) AS logical_sources,
    (SELECT count(DISTINCT CASE
      WHEN evidence.source_type = 'direct_hire_induction' THEN 'owner'
      WHEN evidence.source_type = 'public_website' THEN coalesce(
        evidence.source_authority_key,
        'first-party-site:' || lower(regexp_replace(
          coalesce(evidence.canonical_source_url, evidence.requested_source_url, ''),
          '^https?://([^/]+).*$','\1'
        ))
      )
      ELSE 'unknown:' || evidence.id::text
    END) FROM effective_evidence AS evidence) AS authority_groups,
    (SELECT count(*) FROM effective_evidence) AS evidence_artifacts,
    (SELECT count(*) FROM effective_observations) AS observations,
    (SELECT count(*) FROM current_hypotheses) AS current_hypothesis_count,
    (SELECT count(*) FROM current_briefs) AS current_brief_count
),
inspection AS (
  SELECT '00 TARGET RESOLUTION'::text AS section, 0::bigint AS item_order,
    jsonb_build_object(
      'qa_identity_matches', (SELECT count(*) FROM qa_identity),
      'eligible_ready_lineage_matches', coalesce((SELECT max(candidate_count) FROM candidate_lineage), 0),
      'safe_to_inspect', (SELECT count(*) FROM qa_identity) = 1
        AND coalesce((SELECT max(candidate_count) FROM candidate_lineage), 0) = 1,
      'expected', 'exactly one QA Auth identity and one scheduled ready P2.2 lineage'
    ) AS result

  UNION ALL
  SELECT '01 WORKING SESSION', 1,
    jsonb_build_object(
      'working_session_id', target.id,
      'onboarding_session_id', target.direct_hire_onboarding_session_id,
      'business_representation_id', target.business_representation_id,
      'scheduled_at', target.scheduled_at,
      'scheduling_timezone', target.scheduling_timezone,
      'status', target.status,
      'preparation_status', target.preparation_status,
      'preparation_started_at', target.preparation_started_at,
      'preparation_completed_at', target.preparation_completed_at,
      'preparation_failure_count', target.preparation_attempt_count,
      'preparation_failure_code', target.preparation_failure_code,
      'preparation_contract_version', target.preparation_contract_version,
      'preparation_snapshot_fingerprint', target.preparation_snapshot_fingerprint,
      'website_research_persisted_at', target.preparation_website_persisted_at,
      'website_research_checkpoint_present', target.preparation_website_persisted_at IS NOT NULL
    )
  FROM target

  UNION ALL
  SELECT '02 P1 WEBSITE RESEARCH', row_number() OVER (ORDER BY page.canonical_or_final_url, page.source_page_type),
    jsonb_build_object(
      'effective_successful_company_page_count', counts.effective_company_website_pages,
      'failed_page_count', NULL,
      'failed_page_count_note', 'P2.2 does not durably store per-run failed-page count',
      'legacy_onboarding_successful_page_count_not_attributed_to_p2_2', target.legacy_successful_page_count,
      'legacy_onboarding_failed_page_count_not_attributed_to_p2_2', target.legacy_failed_page_count,
      'legacy_onboarding_extraction_version_not_attributed_to_p2_2', target.legacy_extraction_version,
      'page', jsonb_build_object(
        'canonical_or_final_url', page.canonical_or_final_url,
        'requested_url', page.requested_source_url,
        'page_type', page.source_page_type,
        'logical_page_key', page.page_snapshot_key,
        'authority_key', page.source_authority_key,
        'authority_type', page.source_authority_type,
        'content_snapshot_hash', page.source_content_hash,
        'extraction_version', page.extraction_method_version,
        'retrieved_at', page.retrieved_at,
        'evidence_artifact_count', page.evidence_artifact_count
      )
    )
  FROM website_pages AS page CROSS JOIN quality_counts AS counts CROSS JOIN target

  UNION ALL
  SELECT '03 EFFECTIVE EVIDENCE', row_number() OVER (ORDER BY evidence.created_at, evidence.id),
    jsonb_build_object(
      'evidence_id', evidence.id,
      'source_type', evidence.source_type,
      'page_type', evidence.source_page_type,
      'evidence_kind', evidence.source_evidence_kind,
      'source_url', coalesce(evidence.canonical_source_url, evidence.requested_source_url),
      'website_source_key', evidence.website_source_key,
      'logical_page_key', evidence.page_snapshot_key,
      'registered_public_source_id', evidence.registered_public_source_id,
      'authority_type', evidence.source_authority_type,
      'authority_key', evidence.source_authority_key,
      'content_hash', evidence.source_content_hash,
      'selector', evidence.source_selector,
      'extraction_version', evidence.extraction_method_version,
      'retrieved_at', evidence.source_retrieved_at,
      'captured_by_actor', evidence.captured_by_actor,
      'affected_domains', evidence.affected_domains,
      'raw_statement', left(regexp_replace(evidence.raw_statement, '\s+', ' ', 'g'), 600)
    )
  FROM effective_evidence AS evidence

  UNION ALL
  SELECT '04 OBSERVATIONS', row_number() OVER (ORDER BY observation.created_at, observation.id),
    jsonb_build_object(
      'observation_id', observation.id,
      'evidence_id', observation.evidence_id,
      'website_observation_key', observation.website_observation_key,
      'interpreted_meaning', observation.interpreted_meaning,
      'confidence', observation.confidence_in_interpretation,
      'affected_domains', observation.affected_domains,
      'created_by_actor', observation.created_by_actor,
      'created_at', observation.created_at,
      'evidence_url', coalesce(evidence.canonical_source_url, evidence.requested_source_url),
      'evidence_page_type', evidence.source_page_type,
      'evidence_kind', evidence.source_evidence_kind,
      'evidence_content_hash', evidence.source_content_hash
    )
  FROM effective_observations AS observation
  JOIN effective_evidence AS evidence ON evidence.id = observation.evidence_id

  UNION ALL
  SELECT '05 CURRENT HYPOTHESES', row_number() OVER (ORDER BY hypothesis.constitutional_domain),
    jsonb_build_object(
      'domain', hypothesis.constitutional_domain,
      'version', hypothesis.hypothesis_version,
      'epistemic_status', hypothesis.epistemic_state,
      'confidence', hypothesis.confidence,
      'representation_risk', hypothesis.representation_risk,
      'statement', hypothesis.current_belief,
      'risk_reason', hypothesis.risk_reason,
      'evidence_ids', hypothesis.source_evidence_ids,
      'previous_hypothesis_id', hypothesis.previous_hypothesis_id,
      'successor_ids', coalesce((
        SELECT jsonb_agg(successor.id ORDER BY successor.hypothesis_version)
        FROM hypothesis_history AS successor
        WHERE successor.previous_hypothesis_id = hypothesis.id
      ), '[]'::jsonb),
      'request_trace_id', hypothesis.request_trace_id,
      'evidence_cutoff_at', hypothesis.evidence_cutoff_at,
      'created_by_actor', hypothesis.created_by_actor,
      'created_at', hypothesis.created_at
    )
  FROM current_hypotheses AS hypothesis

  UNION ALL
  SELECT '06 PRIVATE FIRST-WORKING-SESSION BRIEF', row_number() OVER (ORDER BY brief.current DESC, brief.generated_at DESC),
    jsonb_build_object(
      'brief_id', brief.id,
      'current', brief.current,
      'preparation_contract_version', brief.preparation_contract_version,
      'source_snapshot_fingerprint', brief.source_snapshot_fingerprint,
      'hypothesis_trace_fingerprint', brief.hypothesis_trace_fingerprint,
      'source_evidence_ids', brief.source_evidence_ids,
      'source_hypothesis_ids', brief.source_hypothesis_ids,
      'generated_at', brief.generated_at,
      'created_at', brief.created_at,
      'brief', brief.brief
    )
  FROM brief_history AS brief

  UNION ALL
  SELECT '07 QUALITY SUMMARY', 1,
    jsonb_build_object(
      'distinct_effective_company_website_pages', counts.effective_company_website_pages,
      'distinct_effective_logical_sources', counts.logical_sources,
      'distinct_effective_authority_groups', counts.authority_groups,
      'effective_evidence_artifacts', counts.evidence_artifacts,
      'effective_observations', counts.observations,
      'current_hypotheses', counts.current_hypothesis_count,
      'exactly_one_current_private_brief', counts.current_brief_count = 1,
      'current_private_brief_count', counts.current_brief_count,
      'computed_reasoning_snapshot_fingerprint', reasoning.fingerprint,
      'computed_current_hypothesis_trace_fingerprint', hypothesis_trace.fingerprint,
      'computed_expected_brief_snapshot_fingerprint', expected_snapshot.fingerprint,
      'appointment_and_brief_snapshot_match', target.preparation_snapshot_fingerprint = brief.source_snapshot_fingerprint,
      'computed_hypothesis_trace_matches_brief', hypothesis_trace.fingerprint = brief.hypothesis_trace_fingerprint,
      'computed_snapshot_matches_appointment', expected_snapshot.fingerprint = target.preparation_snapshot_fingerprint,
      'computed_snapshot_matches_brief', expected_snapshot.fingerprint = brief.source_snapshot_fingerprint,
      'brief_evidence_ids_are_effective', NOT EXISTS (
        SELECT 1 FROM unnest(brief.source_evidence_ids) AS supplied(evidence_id)
        WHERE NOT EXISTS (SELECT 1 FROM effective_evidence AS evidence WHERE evidence.id = supplied.evidence_id)
      ),
      'brief_hypothesis_ids_are_current', NOT EXISTS (
        SELECT 1 FROM unnest(brief.source_hypothesis_ids) AS supplied(hypothesis_id)
        WHERE NOT EXISTS (SELECT 1 FROM current_hypotheses AS hypothesis WHERE hypothesis.id = supplied.hypothesis_id)
      ),
      'lineage_consistent',
        counts.current_hypothesis_count = 7
        AND counts.current_brief_count = 1
        AND target.preparation_status = 'ready'
        AND target.preparation_snapshot_fingerprint = brief.source_snapshot_fingerprint
        AND hypothesis_trace.fingerprint = brief.hypothesis_trace_fingerprint
        AND expected_snapshot.fingerprint = target.preparation_snapshot_fingerprint
        AND NOT EXISTS (
          SELECT 1 FROM unnest(brief.source_evidence_ids) AS supplied(evidence_id)
          WHERE NOT EXISTS (SELECT 1 FROM effective_evidence AS evidence WHERE evidence.id = supplied.evidence_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest(brief.source_hypothesis_ids) AS supplied(hypothesis_id)
          WHERE NOT EXISTS (SELECT 1 FROM current_hypotheses AS hypothesis WHERE hypothesis.id = supplied.hypothesis_id)
        )
    )
  FROM quality_counts AS counts
  CROSS JOIN target
  CROSS JOIN current_briefs AS brief
  CROSS JOIN reasoning_fingerprint AS reasoning
  CROSS JOIN hypothesis_fingerprint AS hypothesis_trace
  CROSS JOIN expected_brief_snapshot AS expected_snapshot
)
SELECT section, item_order, result
FROM inspection
ORDER BY section, item_order;
