-- Phase 5A preflight. Read-only. Every row must return passed = true.
WITH checks(check_name, passed, details) AS (
  SELECT 'migration_not_applied'::text AS check_name,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('evidence','voice_conversation_candidates')
        AND a.attname IN ('source_public_experience_session_id','source_voice_conversation_output_id','source_voice_context_id','source_tenant_user_id','source_business_id','source_canonical_version_id','source_mission_id','source_provider_conversation_id','source_provider_call_id','source_evidence_id')
        AND NOT a.attisdropped
    ),
    jsonb_build_object('expected_absent',true,'found_columns',COALESCE((
      SELECT jsonb_agg(c.relname||'.'||a.attname ORDER BY c.relname,a.attname)
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('evidence','voice_conversation_candidates')
        AND a.attname IN ('source_public_experience_session_id','source_voice_conversation_output_id','source_voice_context_id','source_tenant_user_id','source_business_id','source_canonical_version_id','source_mission_id','source_provider_conversation_id','source_provider_call_id','source_evidence_id') AND NOT a.attisdropped
    ),'[]'::jsonb))
  UNION ALL
  SELECT 'required_relations_present', count(*)=10,
    jsonb_build_object('actual_count',count(*),'expected_count',10)
  FROM (SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('businesses','business_representations','representation_versions','representation_elements','evidence','audit_events','voice_representation_lineage','voice_conversation_outputs','voice_conversation_candidates','public_experience_sessions')) relations
  UNION ALL
  SELECT 'required_columns_present', count(*)=25,
    jsonb_build_object('actual_count',count(*),'expected_count',25)
  FROM (SELECT c.relname,a.attname FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT a.attisdropped AND a.attnum>0 AND (c.relname,a.attname) IN (
      ('evidence','id'),('evidence','business_representation_id'),('evidence','source_type'),('evidence','source_description'),('evidence','raw_statement'),('evidence','statement_hash'),('evidence','affected_domains'),('evidence','captured_by_actor'),
      ('voice_conversation_outputs','id'),('voice_conversation_outputs','voice_context_id'),('voice_conversation_outputs','tenant_user_id'),('voice_conversation_outputs','business_id'),('voice_conversation_outputs','business_representation_id'),('voice_conversation_outputs','canonical_version_id'),('voice_conversation_outputs','conversation_id'),('voice_conversation_outputs','provider_call_id'),
      ('public_experience_sessions','id'),('public_experience_sessions','tenant_user_id'),('public_experience_sessions','business_id'),('public_experience_sessions','business_representation_id'),('public_experience_sessions','canonical_version_id'),('public_experience_sessions','veya_voice_context_id'),('public_experience_sessions','dispatch_id'),('public_experience_sessions','provider_conversation_id'),('public_experience_sessions','provider_call_id'))) columns
  UNION ALL
  SELECT 'generated_evidence_hash_exact', a.attgenerated='s' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ILIKE '%encode%' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ILIKE '%digest%' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ILIKE '%raw_statement%' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ILIKE '%sha256%' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ILIKE '%hex%',
    jsonb_build_object('generated',a.attgenerated::text,'default',COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'<null>'))
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname='evidence' AND a.attname='statement_hash' AND NOT a.attisdropped
  UNION ALL
  SELECT 'candidate_store_rpc_baseline',
    count(*)=1
      AND bool_and(pg_catalog.pg_get_userbyid(p.proowner)='postgres')
      AND bool_and(p.prosecdef)
      AND bool_and(p.prokind='f')
      AND bool_and(pg_catalog.format_type(p.prorettype,NULL)='integer')
      AND bool_and(p.provolatile='v')
      AND bool_and(p.proconfig=ARRAY['search_path=""']::text[])
      AND bool_and(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))
      AND bool_and(NOT pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'))
      AND bool_and(NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'))
      AND bool_and(NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
      AND bool_and(pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')),
    jsonb_build_object(
      'schema','public','function_name','zeya_store_voice_conversation_candidates',
      'exact_signature',COALESCE(min(p.oid::regprocedure::text),'<missing>'),'exact_signature_count',count(*),
      'named_overload_count',(SELECT count(*) FROM pg_catalog.pg_proc q JOIN pg_catalog.pg_namespace qn ON qn.oid=q.pronamespace WHERE qn.nspname='public' AND q.proname='zeya_store_voice_conversation_candidates'),
      'owner',COALESCE(min(pg_catalog.pg_get_userbyid(p.proowner)),'<missing>'),'security_definer',COALESCE(bool_and(p.prosecdef),false),'prokind',COALESCE(min(p.prokind),'<missing>'),'return_type',COALESCE(min(pg_catalog.format_type(p.prorettype,NULL)),'<missing>'),'volatility',COALESCE(min(p.provolatile),'<missing>'),'configuration',COALESCE(min(p.proconfig::text),'<missing>'),
      'execute_grantees',COALESCE((SELECT jsonb_agg(grantee ORDER BY grantee) FROM (SELECT DISTINCT pg_catalog.pg_get_userbyid(x.grantee) AS grantee FROM pg_catalog.pg_proc ap CROSS JOIN LATERAL aclexplode(COALESCE(ap.proacl,pg_catalog.acldefault('f',ap.proowner))) x WHERE ap.oid=pg_catalog.to_regprocedure('public.zeya_store_voice_conversation_candidates(uuid,text,jsonb)') AND x.privilege_type='EXECUTE' AND x.is_grantable IS NOT NULL) g),'[]'::jsonb),
      'public_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')),false),'anon_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')),false),'authenticated_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')),false),'postgres_execute',COALESCE(bool_and(pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')),false),'service_role_execute',COALESCE(bool_and(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')),false),
      'normalized_definition',COALESCE(min(pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g')),'<missing>'),'definition_md5',COALESCE(min(md5(pg_catalog.pg_get_functiondef(p.oid))),'<missing>'))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid=pg_catalog.to_regprocedure('public.zeya_store_voice_conversation_candidates(uuid,text,jsonb)')
  UNION ALL
  SELECT 'candidate_store_rpc_semantics',
    count(*)=1 AND bool_and(s.src LIKE '%auth.role()<>''service_role''%') AND bool_and(s.src LIKE '%candidatearrayisrequired%') AND bool_and(s.src LIKE '%conversationoutputnotfound%') AND bool_and(s.src LIKE '%conversationtranscriptisnotfinalized%') AND bool_and(s.src LIKE '%invalidextractionschemaversion%') AND bool_and(s.src LIKE '%candidatereferencesunauthorizedRepresentationElement%') AND bool_and(s.src LIKE '%v_output.completed_extraction_schema_version=p_extraction_schema_version%') AND bool_and(s.src LIKE '%v_output.extraction_result_hash=v_result_hash%') AND bool_and(s.src LIKE '%v_output.extracted_candidate_count=v_count%') AND bool_and(s.src LIKE '%voice_conversation_candidates%') AND bool_and(s.src LIKE '%processing_status=''completed''%'),
    jsonb_build_object('normalized_definition',COALESCE(min(s.src),'<missing>'),'definition_md5',COALESCE(min(md5(pg_catalog.pg_get_functiondef(s.oid))),'<missing>'),'markers',jsonb_build_object('service_role_gate',COALESCE(bool_and(s.src LIKE '%auth.role()<>''service_role''%'),false),'array_validation',COALESCE(bool_and(s.src LIKE '%candidatearrayisrequired%'),false),'output_not_found',COALESCE(bool_and(s.src LIKE '%conversationoutputnotfound%'),false),'finalized_transcript',COALESCE(bool_and(s.src LIKE '%conversationtranscriptisnotfinalized%'),false),'schema_validation',COALESCE(bool_and(s.src LIKE '%invalidextractionschemaversion%'),false),'authorized_keys',COALESCE(bool_and(s.src LIKE '%candidatereferencesunauthorizedRepresentationElement%'),false),'idempotency',COALESCE(bool_and(s.src LIKE '%v_output.completed_extraction_schema_version=p_extraction_schema_version%' AND s.src LIKE '%v_output.extraction_result_hash=v_result_hash%' AND s.src LIKE '%v_output.extracted_candidate_count=v_count%'),false),'candidate_insert',COALESCE(bool_and(s.src LIKE '%voice_conversation_candidates%'),false),'completion',COALESCE(bool_and(s.src LIKE '%processing_status=''completed''%'),false)))
  FROM (SELECT p.*,pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') AS src FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.zeya_store_voice_conversation_candidates(uuid,text,jsonb)')) s
  UNION ALL
  SELECT 'object_names_available',count(*)=0,jsonb_build_object('collision_count',count(*))
  FROM (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('voice_outputs_governed_learning_identity_idx','public_experience_governed_learning_identity_idx','evidence_interaction_output_unique_idx','evidence_governed_learning_identity_idx') UNION ALL SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='zeya_enforce_interaction_evidence_authority' UNION ALL SELECT t.oid FROM pg_catalog.pg_trigger t WHERE t.tgname='zeya_interaction_evidence_authority' AND NOT t.tgisinternal) collisions
  UNION ALL
  SELECT 'controlled_purge_semantics_present',
    count(*)=1 AND bool_and(p.prosecdef) AND bool_and(pg_catalog.pg_get_userbyid(p.proowner)='postgres') AND bool_and(p.proconfig=ARRAY['search_path=public, auth, pg_temp']::text[]) AND bool_and(pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') LIKE '%set_config(''zeya.controlled_purge'',''on'',true)%') AND bool_and(pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') LIKE '%set_config(''zeya.controlled_purge'',''off'',true)%') AND bool_and(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) AND bool_and(pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')) AND bool_and(NOT pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')) AND bool_and(NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')) AND bool_and(NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')),
    jsonb_build_object('exact_signature',COALESCE(min(p.oid::regprocedure::text),'<missing>'),'exact_signature_count',count(*),'named_overload_count',(SELECT count(*) FROM pg_catalog.pg_proc q JOIN pg_catalog.pg_namespace qn ON qn.oid=q.pronamespace WHERE qn.nspname='public' AND q.proname='zeya_purge_business_representation'),'owner',COALESCE(min(pg_catalog.pg_get_userbyid(p.proowner)),'<missing>'),'security_definer',COALESCE(bool_and(p.prosecdef),false),'configuration',COALESCE(min(p.proconfig::text),'<missing>'),'execute_grantees',COALESCE((SELECT jsonb_agg(grantee ORDER BY grantee) FROM (SELECT DISTINCT pg_catalog.pg_get_userbyid(x.grantee) AS grantee FROM pg_catalog.pg_proc ap CROSS JOIN LATERAL aclexplode(COALESCE(ap.proacl,pg_catalog.acldefault('f',ap.proowner))) x WHERE ap.oid=pg_catalog.to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)') AND x.privilege_type='EXECUTE' AND x.is_grantable IS NOT NULL) g),'[]'::jsonb),'public_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')),false),'anon_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')),false),'authenticated_execute',COALESCE(bool_and(NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')),false),'postgres_execute',COALESCE(bool_and(pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')),false),'service_role_execute',COALESCE(bool_and(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')),false),'enable_marker',COALESCE(bool_and(pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') LIKE '%set_config(''zeya.controlled_purge'',''on'',true)%'),false),'disable_marker',COALESCE(bool_and(pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') LIKE '%set_config(''zeya.controlled_purge'',''off'',true)%'),false),'definition_md5',COALESCE(min(md5(pg_catalog.pg_get_functiondef(p.oid))),'<missing>'))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=pg_catalog.to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)')
)
SELECT check_name, passed, details
FROM checks
ORDER BY check_name;
