-- Read-only preflight. Every row must pass before manual deployment.
WITH
rpc AS (
  SELECT p.oid, pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
    p.prosecdef, p.proconfig, p.proacl,
    pg_catalog.pg_get_function_result(p.oid)::text AS result_type,
    pg_catalog.regexp_replace(p.prosrc, '[[:space:]]+', '', 'g') AS body
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure(
    'public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)')
),
overloads AS (
  SELECT count(*)::bigint AS count FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='zeya_create_canonical_version_atomic'
),
rpc_acl AS (
  SELECT COALESCE(pg_catalog.array_agg(
    CASE WHEN x.grantee=0 THEN 'PUBLIC'::name ELSE r.rolname END
    ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC'::name ELSE r.rolname END
  ) FILTER (WHERE x.privilege_type='EXECUTE'),ARRAY[]::name[]) AS grantees
  FROM rpc LEFT JOIN LATERAL pg_catalog.aclexplode(rpc.proacl) AS x ON true
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid=x.grantee
),
hash_column AS (
  SELECT tn.nspname::text AS type_schema,t.typname::text AS type_name,a.attnotnull,
    a.attgenerated::text AS generated_state,
    pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'[[:space:]]+','','g') AS expression
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_type AS t ON t.oid=a.atttypid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid=t.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname='representation_versions'
    AND a.attname='content_hash' AND NOT a.attisdropped
),
element_column AS (
  SELECT tn.nspname::text AS type_schema,t.typname::text AS type_name,a.attnotnull,
    count(fk.oid)::bigint AS foreign_key_count
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_type AS t ON t.oid=a.atttypid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid=t.typnamespace
  LEFT JOIN pg_catalog.pg_constraint AS fk ON fk.conrelid=c.oid AND fk.contype='f' AND a.attnum=ANY(fk.conkey)
  WHERE n.nspname='public' AND c.relname='representation_elements'
    AND a.attname='current_value_version_id' AND NOT a.attisdropped
  GROUP BY tn.nspname,t.typname,a.attnotnull
),
element_index AS (
  SELECT count(*)::bigint AS count FROM pg_catalog.pg_indexes
  WHERE schemaname='public' AND tablename='representation_elements'
    AND indexdef LIKE '%(business_representation_id)%'
),
pointer_integrity AS (
  SELECT
    count(*) FILTER (WHERE e.current_value_version_id IS NOT NULL AND v.id IS NULL)::bigint AS dangling,
    count(*) FILTER (WHERE v.id IS NOT NULL AND v.business_representation_id<>e.business_representation_id)::bigint AS cross_representation
  FROM public.representation_elements AS e
  LEFT JOIN public.representation_versions AS v ON v.id=e.current_value_version_id
),
representation_pointer_integrity AS (
  SELECT count(*) FILTER (WHERE b.current_version_id IS NOT NULL AND v.id IS NULL)::bigint AS dangling,
    count(*) FILTER (WHERE v.id IS NOT NULL AND v.business_representation_id<>b.id)::bigint AS cross_representation
  FROM public.business_representations AS b
  LEFT JOIN public.representation_versions AS v ON v.id=b.current_version_id
),
purge AS (
  SELECT pg_catalog.regexp_replace(p.prosrc,'[[:space:]]+','','g') AS body
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid=pg_catalog.to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)')
),
checks(check_name,passed,details) AS (
  SELECT 'rpc_exact_identity'::text,(SELECT count(*) FROM rpc)=1 AND overloads.count=1,
    pg_catalog.jsonb_build_object('exact_count',(SELECT count(*) FROM rpc),'overload_count',overloads.count)
  FROM overloads
  UNION ALL
  SELECT 'rpc_security_and_acl',owner_name='postgres' AND prosecdef
    AND proconfig=ARRAY['search_path=""']::text[]
    AND grantees <@ ARRAY['postgres','service_role']::name[]
    AND grantees @> ARRAY['postgres','service_role']::name[],
    pg_catalog.jsonb_build_object('owner',owner_name,'security_definer',prosecdef,'configuration',proconfig,'execute_grantees',grantees)
  FROM rpc CROSS JOIN rpc_acl
  UNION ALL
  SELECT 'rpc_return_and_atomic_invariants',result_type='TABLE(version_id uuid, version_number bigint, created_at timestamp with time zone)'
    AND body~*'forupdate' AND body~*'max\(version_row\.version_number\)'
    AND body~*'returninginserted_version\.id,inserted_version\.created_at'
    AND body~*'setcurrent_version_id=v_new_version_id' AND body~*'row_count'
    AND body~*'insertintopublic\.audit_events',
    pg_catalog.jsonb_build_object('result_type',result_type,'row_lock',body~*'forupdate','sequence_allocation',body~*'max\(version_row\.version_number\)','representation_pointer',body~*'setcurrent_version_id=v_new_version_id','audit',body~*'insertintopublic\.audit_events')
  FROM rpc
  UNION ALL
  SELECT 'generated_content_hash_exact',type_schema='pg_catalog' AND type_name='text'
    AND NOT attnotnull AND generated_state='s'
    AND expression='encode(digest((element_values)::text,''sha256''::text),''hex''::text)',
    pg_catalog.jsonb_build_object('type_schema',type_schema,'type_name',type_name,'not_null',attnotnull,'generated_state',generated_state,'expression',expression)
  FROM hash_column
  UNION ALL
  SELECT 'deployed_rpc_lacks_element_pointer_update',body!~*'updatepublic\.representation_elements'
    AND body!~*'current_value_version_id=v_new_version_id',
    pg_catalog.jsonb_build_object('has_element_update',body~*'updatepublic\.representation_elements','sets_new_version_pointer',body~*'current_value_version_id=v_new_version_id')
  FROM rpc
  UNION ALL
  SELECT 'element_pointer_schema_and_index',type_schema='pg_catalog' AND type_name='uuid'
    AND NOT attnotnull AND element_index.count>=1,
    pg_catalog.jsonb_build_object('type_schema',type_schema,'type_name',type_name,'not_null',attnotnull,'foreign_key_count',foreign_key_count,'business_representation_index_count',element_index.count)
  FROM element_column CROSS JOIN element_index
  UNION ALL
  SELECT 'element_pointer_integrity',dangling=0 AND cross_representation=0,
    pg_catalog.jsonb_build_object('dangling_count',dangling,'cross_representation_count',cross_representation)
  FROM pointer_integrity
  UNION ALL
  SELECT 'representation_pointer_integrity',dangling=0 AND cross_representation=0,
    pg_catalog.jsonb_build_object('dangling_count',dangling,'cross_representation_count',cross_representation)
  FROM representation_pointer_integrity
  UNION ALL
  SELECT 'controlled_purge_compatible',body~*'set_config\(''zeya\.controlled_purge'',''on'',true\)'
    AND body~*'setcurrent_value_version_id=null'
    AND body~*'deletefrompublic\.representation_versions',
    pg_catalog.jsonb_build_object('transaction_local_enable',body~*'set_config\(''zeya\.controlled_purge'',''on'',true\)','clears_element_pointer',body~*'setcurrent_value_version_id=null','deletes_versions',body~*'deletefrompublic\.representation_versions')
  FROM purge
)
SELECT check_name::text,passed::boolean,details::jsonb FROM checks ORDER BY check_name;
