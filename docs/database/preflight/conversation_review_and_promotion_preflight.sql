-- Phase 3 dependency preflight. Every query must return zero rows unless noted.

-- Object collisions: must return zero rows before the review migration is applied.
SELECT object_kind, object_name
FROM (
  SELECT 'relation' AS object_kind, c.oid::regclass::text AS object_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (
    'conversation_candidate_review_decisions', 'conversation_candidate_promotions',
    'voice_candidates_review_identity_idx', 'voice_outputs_review_identity_idx',
    'conversation_reviews_tenant_idx', 'conversation_reviews_candidate_idx',
    'conversation_promotions_tenant_idx', 'conversation_promotions_output_idx'
  )
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname IN (
    'conversation_candidate_decision_type', 'conversation_candidate_promotion_target'
  )
  UNION ALL
  SELECT 'function', p.oid::regprocedure::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'zeya_enforce_conversation_review_immutability',
    'zeya_review_voice_conversation_candidate',
    'zeya_promote_voice_conversation_candidate'
  )
) collisions;

-- Every source and target dependency with exact PostgreSQL type identity.
-- Must return zero rows.
WITH expected(table_name, column_name, data_type, udt_schema, udt_name) AS (
  VALUES
    ('voice_conversation_candidates','id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','conversation_output_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','tenant_user_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','business_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','business_representation_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','canonical_version_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_candidates','candidate_type','text','pg_catalog','text'),
    ('voice_conversation_candidates','content','jsonb','pg_catalog','jsonb'),
    ('voice_conversation_candidates','speaker_role','text','pg_catalog','text'),
    ('voice_conversation_candidates','source_reference','jsonb','pg_catalog','jsonb'),
    ('voice_conversation_candidates','relevant_element_keys','ARRAY','pg_catalog','_text'),
    ('voice_conversation_candidates','confidence','numeric','pg_catalog','numeric'),
    ('voice_conversation_candidates','transcript_trust_level','text','pg_catalog','text'),
    ('voice_conversation_candidates','extraction_schema_version','text','pg_catalog','text'),
    ('voice_conversation_outputs','id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','voice_context_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','tenant_user_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','business_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','business_representation_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','canonical_version_id','uuid','pg_catalog','uuid'),
    ('voice_conversation_outputs','transcript','jsonb','pg_catalog','jsonb'),
    ('voice_representation_lineage','voice_context_id','uuid','pg_catalog','uuid'),
    ('voice_representation_lineage','tenant_user_id','uuid','pg_catalog','uuid'),
    ('voice_representation_lineage','business_id','uuid','pg_catalog','uuid'),
    ('voice_representation_lineage','business_representation_id','uuid','pg_catalog','uuid'),
    ('voice_representation_lineage','canonical_version_id','uuid','pg_catalog','uuid'),
    ('voice_representation_lineage','authorized_element_keys','ARRAY','pg_catalog','_text'),
    ('evidence','id','uuid','pg_catalog','uuid'),
    ('evidence','business_representation_id','uuid','pg_catalog','uuid'),
    ('evidence','source_type','USER-DEFINED','public','evidence_source_type'),
    ('evidence','source_description','text','pg_catalog','text'),
    ('evidence','raw_statement','text','pg_catalog','text'),
    ('evidence','statement_hash','text','pg_catalog','text'),
    ('evidence','affected_domains','ARRAY','pg_catalog','_text'),
    ('evidence','captured_by_actor','uuid','pg_catalog','uuid'),
    ('observations','business_representation_id','uuid','pg_catalog','uuid'),
    ('observations','evidence_id','uuid','pg_catalog','uuid'),
    ('observations','interpreted_meaning','text','pg_catalog','text'),
    ('observations','confidence_in_interpretation','smallint','pg_catalog','int2'),
    ('observations','affected_domains','ARRAY','pg_catalog','_text'),
    ('observations','affected_elements','ARRAY','pg_catalog','_text'),
    ('observations','created_by_actor','uuid','pg_catalog','uuid'),
    ('representation_proposals','business_representation_id','uuid','pg_catalog','uuid'),
    ('representation_proposals','proposed_changes','jsonb','pg_catalog','jsonb'),
    ('representation_proposals','risk_tier','USER-DEFINED','public','risk_tier'),
    ('representation_proposals','highest_sensitivity_class','USER-DEFINED','public','field_sensitivity_class'),
    ('representation_proposals','requires_approval','boolean','pg_catalog','bool'),
    ('representation_proposals','status','USER-DEFINED','public','proposal_status'),
    ('representation_proposals','proposed_by_actor','uuid','pg_catalog','uuid'),
    ('representation_proposals','rationale','text','pg_catalog','text'),
    ('proposal_evidence','proposal_id','uuid','pg_catalog','uuid'),
    ('proposal_evidence','evidence_id','uuid','pg_catalog','uuid'),
    ('proposal_evidence','business_representation_id','uuid','pg_catalog','uuid'),
    ('proposal_observations','proposal_id','uuid','pg_catalog','uuid'),
    ('proposal_observations','observation_id','uuid','pg_catalog','uuid'),
    ('proposal_observations','business_representation_id','uuid','pg_catalog','uuid'),
    ('proposal_elements','proposal_id','uuid','pg_catalog','uuid'),
    ('proposal_elements','element_id','uuid','pg_catalog','uuid'),
    ('proposal_elements','business_representation_id','uuid','pg_catalog','uuid'),
    ('representation_elements','id','uuid','pg_catalog','uuid'),
    ('representation_elements','element_key','text','pg_catalog','text'),
    ('representation_elements','field_sensitivity','USER-DEFINED','public','field_sensitivity_class')
)
SELECT e.*
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name
WHERE c.column_name IS NULL
   OR c.data_type <> e.data_type
   OR c.udt_schema <> e.udt_schema
   OR c.udt_name <> e.udt_name;

-- Omitted required target columns without defaults/generation: must return zero rows.
WITH inserted(table_name, columns) AS (
  VALUES
    ('evidence', ARRAY['business_representation_id','source_type','source_description','raw_statement','affected_domains','captured_by_actor']),
    ('observations', ARRAY['business_representation_id','evidence_id','interpreted_meaning','confidence_in_interpretation','affected_domains','affected_elements','created_by_actor']),
    ('representation_proposals', ARRAY['business_representation_id','proposed_changes','risk_tier','highest_sensitivity_class','requires_approval','status','proposed_by_actor','rationale']),
    ('proposal_evidence', ARRAY['proposal_id','evidence_id','business_representation_id']),
    ('proposal_observations', ARRAY['proposal_id','observation_id','business_representation_id']),
    ('proposal_elements', ARRAY['proposal_id','element_id','business_representation_id'])
)
SELECT c.table_name, c.column_name
FROM information_schema.columns c
JOIN inserted i ON i.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND c.is_nullable = 'NO'
  AND c.column_default IS NULL
  AND c.is_identity = 'NO'
  AND c.is_generated = 'NEVER'
  AND NOT (c.column_name = ANY(i.columns));

-- Required enum labels: must return zero rows.
WITH expected(type_name, label) AS (
  VALUES ('evidence_source_type','conversation'), ('risk_tier','high'),
         ('proposal_status','pending_approval')
)
SELECT e.* FROM expected e
WHERE NOT EXISTS (
  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  JOIN pg_enum x ON x.enumtypid=t.oid
  WHERE n.nspname='public' AND t.typname=e.type_name AND x.enumlabel=e.label
);

-- Required primary keys: must return zero rows.
WITH required(table_name, columns) AS (
  VALUES
    ('evidence',ARRAY['id']), ('observations',ARRAY['id']),
    ('representation_proposals',ARRAY['id'])
), actual AS (
  SELECT cl.relname AS table_name, array_agg(att.attname ORDER BY key.ord) AS columns
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  JOIN unnest(con.conkey) WITH ORDINALITY key(attnum,ord) ON true
  JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=key.attnum
  WHERE n.nspname='public' AND con.contype='p' GROUP BY cl.relname,con.oid
)
SELECT r.* FROM required r
WHERE NOT EXISTS (SELECT 1 FROM actual a WHERE a.table_name=r.table_name AND a.columns=r.columns);

-- Exact relationship foreign keys, referenced columns, and delete behavior.
-- confdeltype 'c' is ON DELETE CASCADE. Must return zero rows.
WITH expected(source_schema,source_table,source_column,target_schema,target_table,target_column,delete_action) AS (
  VALUES
    ('public','proposal_evidence','proposal_id','public','representation_proposals','id','c'),
    ('public','proposal_evidence','evidence_id','public','evidence','id','c'),
    ('public','proposal_evidence','business_representation_id','public','business_representations','id','c'),
    ('public','proposal_observations','proposal_id','public','representation_proposals','id','c'),
    ('public','proposal_observations','observation_id','public','observations','id','c'),
    ('public','proposal_observations','business_representation_id','public','business_representations','id','c'),
    ('public','proposal_elements','proposal_id','public','representation_proposals','id','c'),
    ('public','proposal_elements','element_id','public','representation_elements','id','c'),
    ('public','proposal_elements','business_representation_id','public','business_representations','id','c')
), actual AS (
  SELECT sn.nspname AS source_schema, sc.relname AS source_table,
         sa.attname AS source_column, tn.nspname AS target_schema,
         tc.relname AS target_table, ta.attname AS target_column,
         con.confdeltype::text AS delete_action
  FROM pg_constraint con
  JOIN pg_class sc ON sc.oid=con.conrelid
  JOIN pg_namespace sn ON sn.oid=sc.relnamespace
  JOIN pg_class tc ON tc.oid=con.confrelid
  JOIN pg_namespace tn ON tn.oid=tc.relnamespace
  JOIN unnest(con.conkey,con.confkey) WITH ORDINALITY keys(source_attnum,target_attnum,ord) ON true
  JOIN pg_attribute sa ON sa.attrelid=con.conrelid AND sa.attnum=keys.source_attnum
  JOIN pg_attribute ta ON ta.attrelid=con.confrelid AND ta.attnum=keys.target_attnum
  WHERE con.contype='f'
)
SELECT e.* FROM expected e
WHERE NOT EXISTS (
  SELECT 1 FROM actual a
  WHERE a.source_schema=e.source_schema AND a.source_table=e.source_table
    AND a.source_column=e.source_column AND a.target_schema=e.target_schema
    AND a.target_table=e.target_table AND a.target_column=e.target_column
    AND a.delete_action=e.delete_action
);

-- Relationship uniqueness preventing duplicate links: must return zero rows.
WITH required(table_name, columns) AS (
  VALUES ('proposal_evidence',ARRAY['proposal_id','evidence_id']),
         ('proposal_observations',ARRAY['proposal_id','observation_id']),
         ('proposal_elements',ARRAY['proposal_id','element_id'])
), actual AS (
  SELECT cl.relname AS table_name, array_agg(att.attname ORDER BY key.ord) AS columns
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  JOIN unnest(con.conkey) WITH ORDINALITY key(attnum,ord) ON true
  JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=key.attnum
  WHERE n.nspname='public' AND con.contype IN ('p','u') GROUP BY cl.relname,con.oid
)
SELECT r.* FROM required r
WHERE NOT EXISTS (SELECT 1 FROM actual a WHERE a.table_name=r.table_name AND a.columns=r.columns);

-- SHA-256 dependency: must return zero rows.
SELECT 'extensions.digest(text,text)' AS missing_function
WHERE to_regprocedure('extensions.digest(text,text)') IS NULL;
