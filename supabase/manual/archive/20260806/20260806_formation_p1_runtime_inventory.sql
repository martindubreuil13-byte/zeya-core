-- ZEYA Formation P1 — Preview runtime-test inventory (strictly read-only)
-- Target project: hdjojgvvlojbhgidirht (Preview only)
-- This statement returns session inventory rows followed by one INVENTORY_SUMMARY row.
-- It exposes identifiers, counts, timestamps, and a partially masked email only.
-- It never returns phone data, transcript content, Evidence/Observation text, or Proposal content.

-- Before running in the Supabase SQL Editor, replace NULL below only with the
-- exact UUID of the already-approved dedicated Preview test owner. Do not infer
-- ownership from an email pattern. With NULL, every non-canonical session is
-- conservatively NOT_OWNED_BY_CURRENT_TEST_ACCOUNT and inventory_ready is false.
-- Expected: use a recommended session only when inventory_ready = true.
WITH runtime_parameters AS (
  SELECT NULL::uuid AS dedicated_preview_test_owner_id
), formation_inventory AS (
  SELECT formation.id AS formation_session_id,
    formation.owner_id,
    CASE
      WHEN auth_user.email IS NULL OR position('@' IN auth_user.email) = 0 THEN NULL
      ELSE left(split_part(auth_user.email, '@', 1), 1)
        || '***@'
        || left(split_part(auth_user.email, '@', 2), 1)
        || '***'
    END AS owner_email_masked,
    formation.business_id,
    formation.business_representation_id,
    formation.status::text AS formation_status,
    formation.initiated_from::text AS initiated_source,
    formation.initiated_from_id,
    formation.first_working_conversation_id AS linked_conversation_output_id,
    coalesce(proposals.proposal_count, 0) AS proposal_count,
    coalesce(proposals.draft_summary_count, 0) AS draft_summary_count,
    coalesce(proposals.valid_draft_summary_count, 0)
      AS current_valid_draft_summary_count,
    representation.current_version_id AS current_version_pointer,
    coalesce(versions.version_count, 0) AS representation_version_count,
    formation.created_at,
    formation.updated_at,
    auth_user.id IS NOT NULL AS owner_account_exists,
    business.id IS NOT NULL
      AND business.user_id = formation.owner_id AS business_lineage_valid,
    representation.id IS NOT NULL
      AND representation.business_id = formation.business_id
      AND representation.user_id = formation.owner_id AS representation_lineage_valid,
    CASE
      WHEN formation.first_working_conversation_id IS NULL THEN true
      ELSE conversation_output.id IS NOT NULL
        AND conversation_output.tenant_user_id = formation.owner_id
        AND conversation_output.business_id = formation.business_id
        AND conversation_output.business_representation_id
          = formation.business_representation_id
        AND conversation_output.transcript_status = 'finalized'
        AND conversation_output.completed_at IS NOT NULL
    END AS conversation_lineage_valid,
    CASE
      WHEN representation.current_version_id IS NULL THEN true
      ELSE current_version.id IS NOT NULL
        AND current_version.business_representation_id
          = formation.business_representation_id
    END AS canonical_pointer_valid
  FROM public.representation_formation_sessions AS formation
  LEFT JOIN auth.users AS auth_user ON auth_user.id = formation.owner_id
  LEFT JOIN public.businesses AS business ON business.id = formation.business_id
  LEFT JOIN public.business_representations AS representation
    ON representation.id = formation.business_representation_id
  LEFT JOIN public.voice_conversation_outputs AS conversation_output
    ON conversation_output.id = formation.first_working_conversation_id
  LEFT JOIN public.representation_versions AS current_version
    ON current_version.id = representation.current_version_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS proposal_count,
      count(*) FILTER (WHERE proposal.status = 'draft') AS draft_summary_count,
      count(*) FILTER (
        WHERE proposal.status = 'draft'
          AND proposal.proposed_changes->'_metadata'->>'formationSessionId'
            = formation.id::text
          AND nullif(
            proposal.proposed_changes->'_metadata'->>'sourceFingerprint', ''
          ) IS NOT NULL
          AND nullif(
            proposal.proposed_changes->'_metadata'->>'generatorVersion', ''
          ) IS NOT NULL
          AND pg_catalog.jsonb_typeof(
            proposal.proposed_changes->'_review'->'sections'
          ) = 'array'
      ) AS valid_draft_summary_count
    FROM public.representation_proposals AS proposal
    WHERE proposal.formation_session_id = formation.id
  ) AS proposals ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS version_count
    FROM public.representation_versions AS version
    WHERE version.business_representation_id
      = formation.business_representation_id
  ) AS versions ON true
), classified AS (
  SELECT inventory.*,
    CASE
      WHEN inventory.current_version_pointer IS NOT NULL
        AND inventory.canonical_pointer_valid
        THEN 'ALREADY_CANONICAL_DO_NOT_TEST'
      WHEN parameters.dedicated_preview_test_owner_id IS NULL
        OR inventory.owner_id
          IS DISTINCT FROM parameters.dedicated_preview_test_owner_id
        THEN 'NOT_OWNED_BY_CURRENT_TEST_ACCOUNT'
      WHEN NOT inventory.owner_account_exists
        OR NOT inventory.business_lineage_valid
        OR NOT inventory.representation_lineage_valid
        OR NOT inventory.conversation_lineage_valid
        OR NOT inventory.canonical_pointer_valid
        OR inventory.current_version_pointer IS NOT NULL
        OR inventory.representation_version_count > 0
        OR inventory.draft_summary_count
          <> inventory.current_valid_draft_summary_count
        OR inventory.draft_summary_count > 1
        THEN 'CONFLICT_OR_INCOMPLETE_LINEAGE'
      WHEN inventory.formation_status = 'working_conversation_pending'
        AND inventory.linked_conversation_output_id IS NULL
        AND inventory.proposal_count = 0
        THEN 'SAFE_PRE_LINKAGE_TEST'
      WHEN inventory.formation_status = 'working_conversation_linked'
        AND inventory.linked_conversation_output_id IS NOT NULL
        AND inventory.current_valid_draft_summary_count = 0
        THEN 'SAFE_SUMMARY_RESUME_TEST'
      WHEN inventory.formation_status = 'working_conversation_linked'
        AND inventory.linked_conversation_output_id IS NOT NULL
        AND inventory.current_valid_draft_summary_count = 1
        THEN 'SAFE_PRE_APPROVAL_REVIEW'
      ELSE 'CONFLICT_OR_INCOMPLETE_LINEAGE'
    END AS runtime_test_classification
  FROM formation_inventory AS inventory
  CROSS JOIN runtime_parameters AS parameters
), recommended AS (
  SELECT formation_session_id, runtime_test_classification
  FROM classified
  WHERE runtime_test_classification IN (
    'SAFE_PRE_LINKAGE_TEST',
    'SAFE_SUMMARY_RESUME_TEST',
    'SAFE_PRE_APPROVAL_REVIEW'
  )
  ORDER BY CASE runtime_test_classification
      WHEN 'SAFE_PRE_LINKAGE_TEST' THEN 1
      WHEN 'SAFE_SUMMARY_RESUME_TEST' THEN 2
      WHEN 'SAFE_PRE_APPROVAL_REVIEW' THEN 3
      ELSE 4
    END,
    created_at DESC,
    formation_session_id
  LIMIT 1
), inventory_summary AS (
  SELECT count(classified.formation_session_id) AS total_formation_sessions,
    count(*) FILTER (
      WHERE runtime_test_classification = 'SAFE_PRE_LINKAGE_TEST'
    ) AS safe_pre_linkage_candidates,
    count(*) FILTER (
      WHERE runtime_test_classification = 'SAFE_SUMMARY_RESUME_TEST'
    ) AS safe_summary_resume_candidates,
    count(*) FILTER (
      WHERE runtime_test_classification = 'SAFE_PRE_APPROVAL_REVIEW'
    ) AS safe_pre_approval_candidates,
    count(*) FILTER (
      WHERE runtime_test_classification = 'ALREADY_CANONICAL_DO_NOT_TEST'
    ) AS canonical_sessions_excluded,
    count(*) FILTER (
      WHERE runtime_test_classification = 'CONFLICT_OR_INCOMPLETE_LINEAGE'
    ) AS conflicting_sessions,
    (SELECT formation_session_id FROM recommended)
      AS recommended_formation_session_id,
    (SELECT runtime_test_classification FROM recommended) AS recommended_test_type,
    parameters.dedicated_preview_test_owner_id IS NOT NULL
      AND (SELECT formation_session_id FROM recommended) IS NOT NULL
      AS inventory_ready
  FROM runtime_parameters AS parameters
  LEFT JOIN classified ON true
  GROUP BY parameters.dedicated_preview_test_owner_id
)
SELECT 'FORMATION_SESSION'::text AS inventory_row_type,
  classified.formation_session_id,
  classified.owner_email_masked,
  classified.business_id,
  classified.business_representation_id,
  classified.formation_status,
  classified.initiated_source,
  classified.initiated_from_id,
  classified.linked_conversation_output_id,
  classified.proposal_count,
  classified.current_valid_draft_summary_count,
  classified.current_version_pointer,
  classified.representation_version_count,
  classified.created_at,
  classified.updated_at,
  classified.runtime_test_classification,
  NULL::bigint AS total_formation_sessions,
  NULL::bigint AS safe_pre_linkage_candidates,
  NULL::bigint AS safe_summary_resume_candidates,
  NULL::bigint AS safe_pre_approval_candidates,
  NULL::bigint AS canonical_sessions_excluded,
  NULL::bigint AS conflicting_sessions,
  NULL::uuid AS recommended_formation_session_id,
  NULL::text AS recommended_test_type,
  NULL::boolean AS inventory_ready
FROM classified
UNION ALL
SELECT 'INVENTORY_SUMMARY'::text,
  NULL::uuid,
  NULL::text,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::uuid,
  NULL::uuid,
  NULL::bigint,
  NULL::bigint,
  NULL::uuid,
  NULL::bigint,
  NULL::timestamptz,
  NULL::timestamptz,
  NULL::text,
  summary.total_formation_sessions,
  summary.safe_pre_linkage_candidates,
  summary.safe_summary_resume_candidates,
  summary.safe_pre_approval_candidates,
  summary.canonical_sessions_excluded,
  summary.conflicting_sessions,
  summary.recommended_formation_session_id,
  summary.recommended_test_type,
  summary.inventory_ready
FROM inventory_summary AS summary;
