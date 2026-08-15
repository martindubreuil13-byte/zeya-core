-- MUTATING CONTROLLED RECOVERY. Review preflight first; execute exactly once manually.
WITH owner_row AS (
  SELECT id FROM auth.users WHERE lower(email)=lower('mdubreu@gmail.com')
)
SELECT recovery.*
FROM owner_row
CROSS JOIN LATERAL public.zeya_reclassify_direct_hire_formation_decision(
  owner_row.id,
  '342500ba-4015-4c0e-91b8-42d1a1de1b3d'::uuid,
  'd5c7a85e-138b-4fd9-8eec-2e04297f4d46'::uuid,
  'primary_target_segment',
  'corrected_application_semantic_mapping'
) recovery;
