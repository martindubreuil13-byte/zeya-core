-- READ ONLY. Run before controlled P2.4 Preview QA.
WITH target AS (SELECT '02546bd3-dd7d-488c-8a04-304d1598502f'::uuid version_id)
SELECT r.id AS business_representation_id,r.user_id,r.current_version_id,v.version_number,v.element_values,
  o.id AS current_mandate_outcome_id,o.outcome_fingerprint,o.readiness_result,
  public.zeya_direct_hire_formation_outcome_is_current(r.user_id,o.id) AS mandate_current,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='mission_leads'
        AND column_name='business_representation_id'
    )
    THEN NULL
    ELSE 0
  END AS p24_lead_count,
  CASE
    WHEN to_regclass('public.operating_missions') IS NULL THEN 0
    ELSE NULL
  END AS p24_mission_count,
  CASE
    WHEN to_regclass('public.mission_execution_contexts') IS NULL THEN 0
    ELSE NULL
  END AS p24_context_count
FROM target t JOIN public.representation_versions v ON v.id=t.version_id
JOIN public.business_representations r ON r.id=v.business_representation_id
JOIN LATERAL (SELECT x.* FROM public.direct_hire_formation_outcome_packages x WHERE x.business_representation_id=r.id
  AND public.zeya_direct_hire_formation_outcome_is_current(r.user_id,x.id) ORDER BY x.finalized_at DESC,x.id DESC LIMIT 1) o ON true;
