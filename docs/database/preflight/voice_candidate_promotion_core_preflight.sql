WITH
target AS (
  SELECT to_regprocedure('public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type)')::oid AS oid
),
functions AS (
  SELECT p.*, n.nspname, pg_get_functiondef(p.oid) AS src,
         pg_get_function_result(p.oid) AS return_type,
         pg_get_userbyid(p.proowner) AS owner_name,
         COALESCE(p.proacl::text, '') AS acl_text
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
pub AS (
  SELECT f.* FROM target t JOIN functions f ON f.oid = t.oid
),
checks(check_name, passed, details) AS (
  SELECT 'internal_function_absent', NOT EXISTS (SELECT 1 FROM functions WHERE proname='zeya_promote_voice_conversation_candidate_internal'), jsonb_build_object('count', (SELECT count(*) FROM functions WHERE proname='zeya_promote_voice_conversation_candidate_internal'))
  UNION ALL SELECT 'public_signature', COALESCE((SELECT count(*)=1 FROM pub), false), jsonb_build_object('count',(SELECT count(*) FROM pub))
  UNION ALL SELECT 'public_identity', COALESCE((SELECT owner_name='postgres' AND prosecdef IS TRUE AND provolatile='v' AND return_type='jsonb' AND proconfig IS NOT NULL AND proconfig @> ARRAY['search_path=""']::text[] AND cardinality(proconfig)=1 FROM pub), false), jsonb_build_object('owner',(SELECT owner_name FROM pub),'security_definer',(SELECT prosecdef FROM pub),'volatility',(SELECT provolatile FROM pub),'return_type',(SELECT return_type FROM pub),'configuration',(SELECT proconfig FROM pub))
  UNION ALL SELECT 'public_acl_preserved', COALESCE((SELECT acl_text LIKE '%postgres=X/%' AND acl_text LIKE '%authenticated=X/%' AND acl_text NOT LIKE '%public=X/%' AND acl_text NOT LIKE '%anon=X/%' AND acl_text NOT LIKE '%service_role=X/%' FROM pub), false), jsonb_build_object('acl',(SELECT acl_text FROM pub))
  UNION ALL SELECT 'public_authentication_markers', COALESCE((SELECT src LIKE '%auth.role()%' AND src LIKE '%auth.uid()%' FROM pub), false), jsonb_build_object('markers',COALESCE((SELECT jsonb_build_object('role',src LIKE '%auth.role()%','uid',src LIKE '%auth.uid()%') FROM pub),'{}'::jsonb))
  UNION ALL SELECT 'promotion_semantics', COALESCE((SELECT src LIKE '%conversation_candidate_review_decisions%' AND src LIKE '%public.evidence%' AND src LIKE '%public.observations%' AND src LIKE '%public.representation_proposals%' AND src LIKE '%public.proposal_evidence%' AND src LIKE '%public.proposal_observations%' AND src LIKE '%public.proposal_elements%' AND src LIKE '%public.conversation_candidate_promotions%' FROM pub), false), jsonb_build_object('source_md5',(SELECT md5(src) FROM pub))
  UNION ALL SELECT 'idempotency_constraints', EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid WHERE t.relname='conversation_candidate_promotions' AND pg_get_constraintdef(c.oid) LIKE '%candidate_id%request_key%'), '{}'::jsonb
  UNION ALL SELECT 'supporting_relations', NOT EXISTS (SELECT 1 FROM unnest(ARRAY['voice_conversation_candidates','voice_conversation_outputs','conversation_candidate_review_decisions','conversation_candidate_promotions','evidence','observations','representation_proposals','proposal_evidence','proposal_observations','proposal_elements','representation_elements','business_representations']) x(name) WHERE to_regclass('public.'||name) IS NULL), '{}'::jsonb
  UNION ALL SELECT 'controlled_purge_compatibility', EXISTS (SELECT 1 FROM functions WHERE proname='zeya_purge_business_representation' AND src LIKE '%conversation_candidate_promotions%' AND src LIKE '%conversation_candidate_review_decisions%'), '{}'::jsonb
)
SELECT check_name::text, passed::boolean, details::jsonb FROM checks ORDER BY check_name;
