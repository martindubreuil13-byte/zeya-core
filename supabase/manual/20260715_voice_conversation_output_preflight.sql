WITH expected(kind, schema_name, object_name) AS (
  VALUES
    ('table','public','voice_conversation_outputs'),
    ('table','public','voice_conversation_candidates'),
    ('function','public','zeya_enforce_voice_output_immutability'),
    ('function','public','zeya_capture_voice_conversation_output'),
    ('function','public','zeya_finalize_voice_conversation_transcript'),
    ('function','public','zeya_set_voice_conversation_processing_status'),
    ('function','public','zeya_store_voice_conversation_candidates'),
    ('trigger','public','zeya_voice_output_immutability'),
    ('policy','public','voice_outputs_tenant_select'),
    ('policy','public','voice_candidates_tenant_select'),
    ('index','public','voice_lineage_identity_idx'),
    ('index','public','voice_outputs_provider_call_idx'),
    ('index','public','voice_outputs_tenant_idx'),
    ('index','public','voice_outputs_business_idx'),
    ('index','public','voice_outputs_representation_idx'),
    ('index','public','voice_candidates_output_idx'),
    ('index','public','voice_candidates_tenant_idx'),
    ('index','public','voice_candidates_business_idx')
), collisions AS (
  SELECT 'table' kind, n.nspname schema_name, c.relname object_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p')
  UNION ALL
  SELECT 'function', n.nspname, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  UNION ALL
  SELECT 'trigger', n.nspname, t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy', schemaname, policyname FROM pg_policies
  UNION ALL
  SELECT 'index', schemaname, indexname FROM pg_indexes
)
SELECT e.kind, e.schema_name, e.object_name,
       (c.object_name IS NOT NULL) AS already_exists
FROM expected e LEFT JOIN collisions c USING (kind, schema_name, object_name)
ORDER BY e.kind, e.object_name;

-- STOP deployment if any already_exists value is true unless the object is
-- positively identified as belonging to this not-yet-deployed migration.
