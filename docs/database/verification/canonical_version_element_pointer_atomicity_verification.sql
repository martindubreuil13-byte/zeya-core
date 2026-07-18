-- Read-only post-deployment verification. Every row must pass.
WITH
rpc AS (
  SELECT p.oid,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,p.prosecdef,p.proconfig,p.proacl,
    pg_catalog.pg_get_function_result(p.oid)::text AS result_type,
    pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') AS body
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid=pg_catalog.to_regprocedure('public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)')
),
acl AS (
  SELECT COALESCE(pg_catalog.array_agg(CASE WHEN x.grantee=0 THEN 'PUBLIC'::name ELSE r.rolname END ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC'::name ELSE r.rolname END)
    FILTER(WHERE x.privilege_type='EXECUTE'),ARRAY[]::name[]) AS grantees
  FROM rpc LEFT JOIN LATERAL pg_catalog.aclexplode(rpc.proacl) AS x ON true
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid=x.grantee
),
hash_column AS (
  SELECT a.attgenerated::text AS generated_state,
    pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'[[:space:]]+','','g') AS expression
  FROM pg_catalog.pg_attribute AS a JOIN pg_catalog.pg_class AS c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attrdef AS d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname='representation_versions' AND a.attname='content_hash' AND NOT a.attisdropped
),
element_integrity AS (
  SELECT count(*) FILTER(WHERE e.current_value_version_id IS NOT NULL AND v.id IS NULL)::bigint AS dangling,
    count(*) FILTER(WHERE v.id IS NOT NULL AND v.business_representation_id<>e.business_representation_id)::bigint AS cross_representation
  FROM public.representation_elements AS e LEFT JOIN public.representation_versions AS v ON v.id=e.current_value_version_id
),
representation_integrity AS (
  SELECT count(*) FILTER(WHERE b.current_version_id IS NOT NULL AND v.id IS NULL)::bigint AS dangling,
    count(*) FILTER(WHERE v.id IS NOT NULL AND v.business_representation_id<>b.id)::bigint AS cross_representation
  FROM public.business_representations AS b LEFT JOIN public.representation_versions AS v ON v.id=b.current_version_id
),
sequence_integrity AS (
  SELECT count(*)::bigint AS duplicates FROM (
    SELECT business_representation_id,version_number FROM public.representation_versions
    GROUP BY business_representation_id,version_number HAVING count(*)>1
  ) AS duplicate_groups
),
checks(check_name,passed,details) AS (
  SELECT 'rpc_identity_security_acl'::text,owner_name='postgres' AND prosecdef
    AND proconfig=ARRAY['search_path=""']::text[]
    AND result_type='TABLE(version_id uuid, version_number bigint, created_at timestamp with time zone)'
    AND grantees <@ ARRAY['postgres','service_role']::name[] AND grantees @> ARRAY['postgres','service_role']::name[],
    pg_catalog.jsonb_build_object('owner',owner_name,'security_definer',prosecdef,'configuration',proconfig,'result_type',result_type,'execute_grantees',grantees)
  FROM rpc CROSS JOIN acl
  UNION ALL
  SELECT 'atomic_version_and_pointer_body',body~*'forupdate'
    AND body~*'max\(version_row\.version_number\)'
    AND body~*'insertintopublic\.representation_versionsasinserted_version\(business_representation_id,previous_version_id,source_proposal_id,source_approval_id,element_values,version_number,overall_confidence_score,created_by_actor\)values'
    AND body!~*'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash'
    AND body~*'setcurrent_version_id=v_new_version_id'
    AND body~*'updatepublic\.representation_elementsaselement_rowsetcurrent_value_version_id=v_new_version_id'
    AND body~*'p_element_values\?element_row\.element_key'
    AND body~*'v_affected_rows<>v_expected_element_rows'
    AND body~*'insertintopublic\.audit_events',
    pg_catalog.jsonb_build_object('row_lock',body~*'forupdate','qualified_sequence',body~*'max\(version_row\.version_number\)','generated_hash_omitted',body!~*'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash','representation_pointer',body~*'setcurrent_version_id=v_new_version_id','element_pointer',body~*'current_value_version_id=v_new_version_id','exact_element_set',body~*'p_element_values\?element_row\.element_key','affected_row_enforcement',body~*'v_affected_rows<>v_expected_element_rows','audit',body~*'insertintopublic\.audit_events')
  FROM rpc
  UNION ALL
  SELECT 'generated_hash_preserved',generated_state='s' AND expression='encode(digest((element_values)::text,''sha256''::text),''hex''::text)',
    pg_catalog.jsonb_build_object('generated_state',generated_state,'expression',expression)
  FROM hash_column
  UNION ALL
  SELECT 'element_pointer_integrity',dangling=0 AND cross_representation=0,
    pg_catalog.jsonb_build_object('dangling_count',dangling,'cross_representation_count',cross_representation)
  FROM element_integrity
  UNION ALL
  SELECT 'representation_pointer_integrity',dangling=0 AND cross_representation=0,
    pg_catalog.jsonb_build_object('dangling_count',dangling,'cross_representation_count',cross_representation)
  FROM representation_integrity
  UNION ALL
  SELECT 'version_sequence_integrity',duplicates=0,pg_catalog.jsonb_build_object('duplicate_group_count',duplicates)
  FROM sequence_integrity
)
SELECT check_name::text,passed::boolean,details::jsonb FROM checks ORDER BY check_name;
