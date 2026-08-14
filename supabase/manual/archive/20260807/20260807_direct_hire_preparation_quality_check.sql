-- Direct Hire Preparation Quality Check
-- Inspect website research and evidence collection for current QA owner
-- Target owner: da53cf7f-beb1-4168-a0cb-015610f092fc (mdubreu@gmail.com)
-- Strictly read-only inspection. One row result.
-- No raw_statement content, URLs, or sensitive data returned.

WITH owner_context AS (
  SELECT
    'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id
),

onboarding_session AS (
  SELECT
    id,
    business_representation_id
  FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = (SELECT owner_id FROM owner_context)
  LIMIT 1
)

SELECT
  -- Evidence counts by type
  (
    SELECT COUNT(*)::integer
    FROM public.evidence
    WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND source_type = 'public_website'
      AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
  ) AS website_evidence_count,

  -- Evidence with non-null raw_statement (actual content captured)
  (
    SELECT COUNT(*)::integer
    FROM public.evidence
    WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND source_type = 'public_website'
      AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
      AND raw_statement IS NOT NULL
      AND raw_statement != ''
  ) AS evidence_with_content_count,

  -- Evidence with source_url (URL tracking)
  (
    SELECT COUNT(*)::integer
    FROM public.evidence
    WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND source_type = 'public_website'
      AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
      AND source_url IS NOT NULL
  ) AS evidence_with_source_url_count,

  -- Distinct page URLs found
  (
    SELECT COUNT(DISTINCT source_url)::integer
    FROM public.evidence
    WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND source_type = 'public_website'
      AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
      AND source_url IS NOT NULL
  ) AS distinct_page_url_count,

  -- Observations linked to website Evidence
  (
    SELECT COUNT(*)::integer
    FROM public.observations o
    INNER JOIN public.evidence e ON o.evidence_id = e.id
    WHERE e.business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND e.source_type = 'public_website'
      AND e.direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
  ) AS linked_observation_count,

  -- Observations with non-null interpretation (actual analysis)
  (
    SELECT COUNT(*)::integer
    FROM public.observations o
    INNER JOIN public.evidence e ON o.evidence_id = e.id
    WHERE e.business_representation_id = (SELECT business_representation_id FROM onboarding_session)
      AND e.source_type = 'public_website'
      AND e.direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
      AND o.interpretation IS NOT NULL
      AND o.interpretation != ''
  ) AS observations_with_interpretation_count,

  -- Quality assessment: evidence has content but observations lack depth
  CASE
    WHEN (
      SELECT COUNT(*)::integer
      FROM public.evidence
      WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
        AND source_type = 'public_website'
        AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
        AND raw_statement IS NOT NULL
        AND raw_statement != ''
    ) > 0
    AND (
      SELECT COUNT(*)::integer
      FROM public.observations o
      INNER JOIN public.evidence e ON o.evidence_id = e.id
      WHERE e.business_representation_id = (SELECT business_representation_id FROM onboarding_session)
        AND e.source_type = 'public_website'
        AND e.direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
        AND o.interpretation IS NOT NULL
        AND o.interpretation != ''
    ) = 0
    THEN 'evidence_captured_but_analysis_sparse'
    WHEN (
      SELECT COUNT(*)::integer
      FROM public.evidence
      WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
        AND source_type = 'public_website'
        AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
        AND raw_statement IS NOT NULL
        AND raw_statement != ''
    ) = 0
    THEN 'evidence_not_captured'
    ELSE 'evidence_and_analysis_present'
  END AS quality_status;
