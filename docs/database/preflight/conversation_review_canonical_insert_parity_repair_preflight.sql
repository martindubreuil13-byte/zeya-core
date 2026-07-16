-- Read-only preflight for the canonical insert-parity repair.
-- Every named check must return passed = true before applying the repair.
WITH target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl,
         pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type)'::regprocedure
), checks AS (
  SELECT 'promotion function is the exact broken repair target'::text AS check_name,
    count(*) = 1
      AND bool_and(pg_get_userbyid(proowner) = 'postgres')
      AND bool_and(prosecdef)
      AND bool_and(proconfig = ARRAY['search_path=""'])
      AND bool_and(definition LIKE '%actor uuid;%')
      AND bool_and(definition LIKE '%actor:=auth.uid();%')
      AND bool_and(definition LIKE '%INSERT INTO public.evidence(id,business_representation_id,source_type,source_description,raw_statement,statement_hash,affected_domains,captured_by_actor)%')
      AND bool_and(definition LIKE '%INSERT INTO public.representation_proposals(business_representation_id,affected_element_ids,proposed_changes,supporting_observation_ids,supporting_evidence_ids,%') AS passed,
    jsonb_build_object('signature', max(oid::regprocedure::text), 'owner', max(pg_get_userbyid(proowner)), 'security_definer', bool_and(prosecdef), 'configuration', max(proconfig::text), 'definition_md5', max(md5(definition))) AS details
  FROM target_function
  UNION ALL
  SELECT 'repair has not already been applied',
    count(*) = 1 AND bool_and(definition NOT LIKE '%INSERT INTO public.evidence(business_representation_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)%'),
    jsonb_build_object('definition_md5', max(md5(definition)))
  FROM target_function
), expected_columns(table_name,column_name,type_category,type_schema,type_name,not_null,identity_state,generated_state) AS (
  VALUES
    ('evidence','id','U','pg_catalog','uuid',true,'',''),
    ('evidence','business_representation_id','U','pg_catalog','uuid',true,'',''),
    ('evidence','source_type','E','public','evidence_source_type',true,'',''),
    ('evidence','source_description','S','pg_catalog','text',false,'',''),
    ('evidence','raw_statement','S','pg_catalog','text',true,'',''),
    ('evidence','statement_hash','S','pg_catalog','text',false,'','s'),
    ('evidence','affected_domains','A','pg_catalog','_text',true,'',''),
    ('evidence','captured_by_actor','U','pg_catalog','uuid',false,'',''),
    ('evidence','created_at','D','pg_catalog','timestamptz',true,'',''),
    ('observations','id','U','pg_catalog','uuid',true,'',''),
    ('observations','business_representation_id','U','pg_catalog','uuid',true,'',''),
    ('observations','evidence_id','U','pg_catalog','uuid',true,'',''),
    ('observations','interpreted_meaning','S','pg_catalog','text',true,'',''),
    ('observations','confidence_in_interpretation','N','pg_catalog','int2',true,'',''),
    ('observations','affected_domains','A','pg_catalog','_text',true,'',''),
    ('observations','affected_elements','A','pg_catalog','_text',true,'',''),
    ('observations','created_by_actor','U','pg_catalog','uuid',false,'',''),
    ('observations','created_at','D','pg_catalog','timestamptz',true,'',''),
    ('representation_proposals','id','U','pg_catalog','uuid',true,'',''),
    ('representation_proposals','business_representation_id','U','pg_catalog','uuid',true,'',''),
    ('representation_proposals','proposed_changes','U','pg_catalog','jsonb',true,'',''),
    ('representation_proposals','risk_tier','E','public','risk_tier',false,'',''),
    ('representation_proposals','highest_sensitivity_class','E','public','field_sensitivity_class',false,'',''),
    ('representation_proposals','requires_approval','B','pg_catalog','bool',true,'',''),
    ('representation_proposals','status','E','public','proposal_status',true,'',''),
    ('representation_proposals','status_updated_at','D','pg_catalog','timestamptz',true,'',''),
    ('representation_proposals','proposed_by_actor','U','pg_catalog','uuid',true,'',''),
    ('representation_proposals','rationale','S','pg_catalog','text',false,'',''),
    ('representation_proposals','expires_at','D','pg_catalog','timestamptz',false,'',''),
    ('representation_proposals','created_at','D','pg_catalog','timestamptz',true,'',''),
    ('proposal_evidence','proposal_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_evidence','evidence_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_evidence','business_representation_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_observations','proposal_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_observations','observation_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_observations','business_representation_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_elements','proposal_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_elements','element_id','U','pg_catalog','uuid',true,'',''),
    ('proposal_elements','business_representation_id','U','pg_catalog','uuid',true,'','')
), actual_columns AS (
  SELECT c.relname AS table_name, a.attname AS column_name,
    t.typcategory::text AS type_category, tn.nspname AS type_schema,
    t.typname AS type_name, a.attnotnull AS not_null,
    a.attidentity::text AS identity_state, a.attgenerated::text AS generated_state,
    pg_get_expr(d.adbin,d.adrelid) AS default_or_generation_expression
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_type t ON t.oid=a.atttypid
  JOIN pg_namespace tn ON tn.oid=t.typnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname IN ('evidence','observations','representation_proposals','proposal_evidence','proposal_observations','proposal_elements')
    AND a.attnum>0 AND NOT a.attisdropped
), schema_checks AS (
  SELECT 'target column contract has no missing, extra, or divergent columns'::text AS check_name,
    NOT EXISTS(
      (SELECT table_name,column_name,type_category,type_schema,type_name,not_null,identity_state,generated_state FROM expected_columns
       EXCEPT SELECT table_name,column_name,type_category,type_schema,type_name,not_null,identity_state,generated_state FROM actual_columns)
      UNION ALL
      (SELECT table_name,column_name,type_category,type_schema,type_name,not_null,identity_state,generated_state FROM actual_columns
       EXCEPT SELECT table_name,column_name,type_category,type_schema,type_name,not_null,identity_state,generated_state FROM expected_columns)
    ) AS passed,
    jsonb_build_object('expected_count',(SELECT count(*) FROM expected_columns),'actual_count',(SELECT count(*) FROM actual_columns)) AS details
  UNION ALL
  SELECT 'Evidence statement_hash is database-generated SHA-256',
    count(*)=1 AND bool_and(generated_state='s') AND bool_and(default_or_generation_expression IS NOT NULL)
      AND bool_and(default_or_generation_expression ILIKE '%digest%')
      AND bool_and(default_or_generation_expression ILIKE '%raw_statement%')
      AND bool_and(default_or_generation_expression ILIKE '%sha256%'),
    jsonb_build_object('expression',max(default_or_generation_expression),'generated_state',max(generated_state))
  FROM actual_columns WHERE table_name='evidence' AND column_name='statement_hash'
  UNION ALL
  SELECT 'all omitted required target columns are defaulted or generated',
    NOT EXISTS (
      SELECT 1 FROM actual_columns a
      WHERE a.not_null AND a.default_or_generation_expression IS NULL AND a.generated_state=''
        AND NOT (
          (a.table_name='evidence' AND a.column_name IN ('business_representation_id','source_type','raw_statement','affected_domains')) OR
          (a.table_name='observations' AND a.column_name IN ('business_representation_id','evidence_id','interpreted_meaning','confidence_in_interpretation','affected_domains','affected_elements')) OR
          (a.table_name='representation_proposals' AND a.column_name IN ('business_representation_id','proposed_changes','requires_approval','status','proposed_by_actor')) OR
          (a.table_name='proposal_evidence' AND a.column_name IN ('proposal_id','evidence_id','business_representation_id')) OR
          (a.table_name='proposal_observations' AND a.column_name IN ('proposal_id','observation_id','business_representation_id')) OR
          (a.table_name='proposal_elements' AND a.column_name IN ('proposal_id','element_id','business_representation_id'))
        )
    ), '{}'::jsonb
), expected_relationship_keys(source_table,source_columns,target_table,target_columns,delete_action) AS (
  VALUES
    ('proposal_evidence',ARRAY['proposal_id','business_representation_id']::text[],'representation_proposals',ARRAY['id','business_representation_id']::text[],'c'),
    ('proposal_evidence',ARRAY['evidence_id','business_representation_id']::text[],'evidence',ARRAY['id','business_representation_id']::text[],'r'),
    ('proposal_observations',ARRAY['proposal_id','business_representation_id']::text[],'representation_proposals',ARRAY['id','business_representation_id']::text[],'c'),
    ('proposal_observations',ARRAY['observation_id','business_representation_id']::text[],'observations',ARRAY['id','business_representation_id']::text[],'r'),
    ('proposal_elements',ARRAY['proposal_id','business_representation_id']::text[],'representation_proposals',ARRAY['id','business_representation_id']::text[],'c'),
    ('proposal_elements',ARRAY['element_id','business_representation_id']::text[],'representation_elements',ARRAY['id','business_representation_id']::text[],'r')
), actual_relationship_keys AS (
  SELECT sc.relname AS source_table,
    array_agg(sa.attname ORDER BY keys.ordinality)::text[] AS source_columns,
    tc.relname AS target_table,
    array_agg(ta.attname ORDER BY keys.ordinality)::text[] AS target_columns,
    con.confdeltype::text AS delete_action,
    con.conname
  FROM pg_constraint con
  JOIN pg_class sc ON sc.oid=con.conrelid
  JOIN pg_namespace sn ON sn.oid=sc.relnamespace
  JOIN pg_class tc ON tc.oid=con.confrelid
  JOIN pg_namespace tn ON tn.oid=tc.relnamespace
  JOIN unnest(con.conkey,con.confkey) WITH ORDINALITY AS keys(source_attnum,target_attnum,ordinality) ON true
  JOIN pg_attribute sa ON sa.attrelid=con.conrelid AND sa.attnum=keys.source_attnum
  JOIN pg_attribute ta ON ta.attrelid=con.confrelid AND ta.attnum=keys.target_attnum
  WHERE con.contype='f' AND sn.nspname='public' AND tn.nspname='public'
    AND sc.relname IN ('proposal_evidence','proposal_observations','proposal_elements')
  GROUP BY sc.relname,tc.relname,con.confdeltype,con.conname
), expected_relationship_uniqueness(table_name,columns) AS (
  VALUES
    ('proposal_evidence',ARRAY['proposal_id','evidence_id']::text[]),
    ('proposal_observations',ARRAY['proposal_id','observation_id']::text[]),
    ('proposal_elements',ARRAY['proposal_id','element_id']::text[])
), actual_relationship_uniqueness AS (
  SELECT c.relname AS table_name,
    array_agg(a.attname ORDER BY keys.ordinality)::text[] AS columns,
    con.contype::text AS constraint_type,
    con.conname
  FROM pg_constraint con
  JOIN pg_class c ON c.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN unnest(con.conkey) WITH ORDINALITY AS keys(attnum,ordinality) ON true
  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=keys.attnum
  WHERE n.nspname='public' AND c.relname IN ('proposal_evidence','proposal_observations','proposal_elements')
    AND con.contype IN ('p','u')
  GROUP BY c.relname,con.contype,con.conname
), relationship_checks AS (
  SELECT 'relationship primary or unique identities are exact'::text AS check_name,
    NOT EXISTS (
      (SELECT table_name,columns FROM expected_relationship_uniqueness
       EXCEPT
       SELECT table_name,columns FROM actual_relationship_uniqueness)
      UNION ALL
      (SELECT table_name,columns FROM actual_relationship_uniqueness
       EXCEPT
       SELECT table_name,columns FROM expected_relationship_uniqueness)
    ) AS passed,
    (SELECT jsonb_agg(jsonb_build_object('table',table_name,'columns',columns,'constraint_type',constraint_type,'name',conname) ORDER BY table_name,conname) FROM actual_relationship_uniqueness) AS details
  UNION ALL
  SELECT 'relationship composite foreign keys and delete actions are exact',
    NOT EXISTS (
      (SELECT source_table,source_columns,target_table,target_columns,delete_action FROM expected_relationship_keys
       EXCEPT
       SELECT source_table,source_columns,target_table,target_columns,delete_action FROM actual_relationship_keys)
      UNION ALL
      (SELECT source_table,source_columns,target_table,target_columns,delete_action FROM actual_relationship_keys
       EXCEPT
       SELECT source_table,source_columns,target_table,target_columns,delete_action FROM expected_relationship_keys)
    ),
    (SELECT jsonb_agg(jsonb_build_object('name',conname,'source_table',source_table,'source_columns',source_columns,'target_table',target_table,'target_columns',target_columns,'delete_action',delete_action) ORDER BY source_table,source_columns) FROM actual_relationship_keys)
)
SELECT * FROM checks
UNION ALL SELECT * FROM schema_checks
UNION ALL SELECT * FROM relationship_checks
ORDER BY check_name;

-- Exact catalog inventory. Retain this output with deployment evidence.
SELECT c.relname AS table_name, a.attnum AS ordinal_position, a.attname AS column_name,
  tn.nspname AS type_schema, t.typname AS exact_type_name, t.typcategory AS type_category,
  pg_catalog.format_type(a.atttypid,a.atttypmod) AS human_readable_type,
  a.attnotnull AS not_null, a.attidentity AS identity_state, a.attgenerated AS generated_state,
  pg_get_expr(d.adbin,d.adrelid) AS default_or_generation_expression
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_type t ON t.oid=a.atttypid
JOIN pg_namespace tn ON tn.oid=t.typnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN ('evidence','observations','representation_proposals','proposal_evidence','proposal_observations','proposal_elements')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum;

SELECT conrelid::regclass AS source_table, conname, contype,
  pg_get_constraintdef(oid,true) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.evidence'::regclass,'public.observations'::regclass,'public.representation_proposals'::regclass,
  'public.proposal_evidence'::regclass,'public.proposal_observations'::regclass,'public.proposal_elements'::regclass)
ORDER BY conrelid::regclass::text,conname;
