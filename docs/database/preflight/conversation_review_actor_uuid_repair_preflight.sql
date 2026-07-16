-- Read-only preflight for the conversation review actor UUID repair.
WITH target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type)'::regprocedure
), actor_columns AS (
  SELECT table_name, column_name, data_type, udt_schema, udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('evidence', 'captured_by_actor'),
      ('observations', 'created_by_actor'),
      ('representation_proposals', 'proposed_by_actor')
    )
)
SELECT 'promotion function is exact repair target' AS check_name,
  count(*) = 1
    AND bool_and(pg_get_userbyid(proowner) = 'postgres')
    AND bool_and(prosecdef)
    AND bool_and(proconfig = ARRAY['search_path=""'])
    AND bool_and(definition LIKE '%actor text;%')
    AND bool_and(definition LIKE '%actor:=auth.uid()::text;%') AS passed,
  jsonb_build_object('owner', max(pg_get_userbyid(proowner)), 'security_definer', bool_and(prosecdef), 'configuration', max(proconfig::text), 'acl', max(proacl::text)) AS details
FROM target_function
UNION ALL
SELECT 'actor columns are UUID', count(*) = 3 AND bool_and(data_type = 'uuid' AND udt_schema = 'pg_catalog' AND udt_name = 'uuid'),
  jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type) ORDER BY table_name)::jsonb
FROM actor_columns;
