-- Preflight: Canonical Version pointer atomicity.
-- Read-only. Every returned row must have passed = true before deployment.
-- Result contract: check_name TEXT, passed BOOLEAN, details JSONB.

WITH
expected_version_columns(
  ordinal_position,
  column_name,
  type_schema,
  type_name,
  not_null,
  has_default
) AS (
  VALUES
    (1, 'id'::text, 'pg_catalog'::text, 'uuid'::text, true, true),
    (2, 'business_representation_id', 'pg_catalog', 'uuid', true, false),
    (3, 'previous_version_id', 'pg_catalog', 'uuid', false, false),
    (4, 'source_proposal_id', 'pg_catalog', 'uuid', true, false),
    (5, 'source_approval_id', 'pg_catalog', 'uuid', false, false),
    (6, 'element_values', 'pg_catalog', 'jsonb', true, false),
    (7, 'version_number', 'pg_catalog', 'int8', true, false),
    (8, 'overall_confidence_score', 'pg_catalog', 'int2', true, false),
    (9, 'created_by_actor', 'pg_catalog', 'uuid', true, false),
    (10, 'created_at', 'pg_catalog', 'timestamptz', true, true),
    (11, 'content_hash', 'pg_catalog', 'text', false, true)
),
expected_representation_columns(column_name, type_schema, type_name, not_null) AS (
  VALUES
    ('id'::text, 'pg_catalog'::text, 'uuid'::text, true),
    ('business_id', 'pg_catalog', 'uuid', true),
    ('user_id', 'pg_catalog', 'uuid', true),
    ('current_version_id', 'pg_catalog', 'uuid', false)
),
actual_columns AS (
  SELECT
    c.relname::text AS table_name,
    a.attnum::integer AS ordinal_position,
    a.attname::text AS column_name,
    tn.nspname::text AS type_schema,
    t.typname::text AS type_name,
    a.attnotnull AS not_null,
    default_row.oid IS NOT NULL AS has_default
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c
    ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type AS t
    ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace AS tn
    ON tn.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS default_row
    ON default_row.adrelid = a.attrelid
   AND default_row.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname IN ('representation_versions', 'business_representations')
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
version_column_diff AS (
  SELECT * FROM expected_version_columns
  EXCEPT
  SELECT ordinal_position, column_name, type_schema, type_name, not_null, has_default
  FROM actual_columns
  WHERE table_name = 'representation_versions'
),
unexpected_version_columns AS (
  SELECT ordinal_position, column_name, type_schema, type_name, not_null, has_default
  FROM actual_columns
  WHERE table_name = 'representation_versions'
  EXCEPT
  SELECT * FROM expected_version_columns
),
content_hash_default AS (
  SELECT
    count(*) FILTER (
      WHERE pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
        '[[:space:]]+',
        '',
        'g'
      ) = 'encode(digest((element_values)::text,''sha256''::text),''hex''::text)'
    )::bigint AS matching_default_count,
    max(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
        '[[:space:]]+',
        '',
        'g'
      )
    )::text AS normalized_default
  FROM pg_catalog.pg_attribute AS attribute_row
  JOIN pg_catalog.pg_class AS table_row
    ON table_row.oid = attribute_row.attrelid
  JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_namespace.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attrdef AS default_row
    ON default_row.adrelid = attribute_row.attrelid
   AND default_row.adnum = attribute_row.attnum
  WHERE table_namespace.nspname = 'public'
    AND table_row.relname = 'representation_versions'
    AND attribute_row.attname = 'content_hash'
    AND NOT attribute_row.attisdropped
),
representation_column_diff AS (
  SELECT * FROM expected_representation_columns
  EXCEPT
  SELECT column_name, type_schema, type_name, not_null
  FROM actual_columns
  WHERE table_name = 'business_representations'
),

atomic_rpc_catalog AS (
  SELECT
    p.oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid)::text AS identity_arguments
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_create_canonical_version_atomic'
),

pointer_inventory AS (
  SELECT
    count(*) FILTER (
      WHERE br.current_version_id IS NOT NULL
    )::bigint AS nonnull_pointer_count,
    count(*) FILTER (
      WHERE br.current_version_id IS NOT NULL
        AND rv.id IS NULL
    )::bigint AS dangling_pointer_count,
    count(*) FILTER (
      WHERE br.current_version_id IS NOT NULL
        AND rv.id IS NOT NULL
        AND rv.business_representation_id IS DISTINCT FROM br.id
    )::bigint AS cross_representation_pointer_count
  FROM public.business_representations AS br
  LEFT JOIN public.representation_versions AS rv
    ON rv.id = br.current_version_id
),
duplicate_version_sequences AS (
  SELECT count(*)::bigint AS duplicate_group_count
  FROM (
    SELECT rv.business_representation_id, rv.version_number
    FROM public.representation_versions AS rv
    GROUP BY rv.business_representation_id, rv.version_number
    HAVING count(*) > 1
  ) AS duplicate_groups
),
exact_version_sequence_unique AS (
  SELECT count(*)::bigint AS exact_unique_count
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS c
    ON c.oid = i.indrelid
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'representation_versions'
    AND i.indisunique
    AND i.indisvalid
    AND i.indpred IS NULL
    AND i.indexprs IS NULL
    AND (
      SELECT pg_catalog.array_agg(a.attname::text ORDER BY key_position.ordinality)
      FROM pg_catalog.unnest(i.indkey::smallint[]) WITH ORDINALITY
        AS key_position(attnum, ordinality)
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = i.indrelid
       AND a.attnum = key_position.attnum
      WHERE key_position.ordinality <= i.indnkeyatts
    ) = ARRAY['business_representation_id', 'version_number']::text[]
),

trigger_catalog AS (
  SELECT
    table_class.relname::text AS table_name,
    trigger_row.tgname::text AS trigger_name,
    trigger_row.tgenabled::text AS enabled_state,
    trigger_row.tgtype::integer AS trigger_type,
    function_namespace.nspname::text AS function_schema,
    function_row.proname::text AS function_name,
    pg_catalog.pg_get_userbyid(function_row.proowner)::text AS function_owner,
    function_row.prosecdef AS security_definer,
    function_row.proconfig,
    function_row.oid AS function_oid,
    pg_catalog.regexp_replace(function_row.prosrc, '[[:space:]]+', '', 'g')
      AS normalized_function_body
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS table_class
    ON table_class.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_namespace.oid = table_class.relnamespace
  JOIN pg_catalog.pg_proc AS function_row
    ON function_row.oid = trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_row.pronamespace
  WHERE table_namespace.nspname = 'public'
    AND NOT trigger_row.tgisinternal
    AND table_class.relname IN ('representation_versions', 'audit_events')
),
version_trigger_summary AS (
  SELECT
    count(*) FILTER (
      WHERE table_name = 'representation_versions'
        AND trigger_name = 'trg_representation_versions_immutable'
        AND enabled_state = 'O'
        AND trigger_type = 27
        AND function_schema = 'public'
        AND function_name = 'zeya_block_update_delete'
        AND function_oid = pg_catalog.to_regprocedure('public.zeya_block_update_delete()')
        AND function_owner = 'postgres'
        AND NOT security_definer
        AND proconfig IS NULL
        AND normalized_function_body ~* 'raiseexception'
    )::bigint AS exact_trigger_count,
    count(*) FILTER (
      WHERE table_name = 'representation_versions'
    )::bigint AS table_trigger_count
  FROM trigger_catalog
),
audit_trigger_summary AS (
  SELECT
    count(*) FILTER (
      WHERE table_name = 'audit_events'
        AND trigger_name = 'trg_audit_events_immutable'
        AND enabled_state = 'O'
        AND trigger_type = 27
        AND function_schema = 'public'
        AND function_name = 'zeya_block_update_delete'
        AND function_oid = pg_catalog.to_regprocedure('public.zeya_block_update_delete()')
        AND function_owner = 'postgres'
        AND NOT security_definer
        AND proconfig IS NULL
        AND normalized_function_body ~* 'raiseexception'
    )::bigint AS exact_trigger_count,
    count(*) FILTER (
      WHERE table_name = 'audit_events'
    )::bigint AS table_trigger_count
  FROM trigger_catalog
),

current_version_fk AS (
  SELECT
    count(*) FILTER (
      WHERE constraint_name = 'fk_business_representations_current_version'
        AND source_columns = ARRAY['current_version_id', 'id']::text[]
        AND target_schema = 'public'
        AND target_table = 'representation_versions'
        AND target_columns = ARRAY['id', 'business_representation_id']::text[]
        AND constraint_valid
        AND constraint_deferrable
        AND constraint_initially_deferred
        AND update_action = 'a'
        AND delete_action = 'a'
    )::bigint AS exact_fk_count,
    count(*)::bigint AS current_version_fk_count
  FROM (
    SELECT
      constraint_row.conname::text AS constraint_name,
      pg_catalog.array_agg(source_attribute.attname::text ORDER BY source_key.ordinality)
        AS source_columns,
      target_namespace.nspname::text AS target_schema,
      target_class.relname::text AS target_table,
      pg_catalog.array_agg(target_attribute.attname::text ORDER BY source_key.ordinality)
        AS target_columns,
      constraint_row.convalidated AS constraint_valid,
      constraint_row.condeferrable AS constraint_deferrable,
      constraint_row.condeferred AS constraint_initially_deferred,
      constraint_row.confupdtype::text AS update_action,
      constraint_row.confdeltype::text AS delete_action
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS source_class
      ON source_class.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS source_namespace
      ON source_namespace.oid = source_class.relnamespace
    JOIN pg_catalog.pg_class AS target_class
      ON target_class.oid = constraint_row.confrelid
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_class.relnamespace
    CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
      WITH ORDINALITY AS source_key(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS source_attribute
      ON source_attribute.attrelid = source_class.oid
     AND source_attribute.attnum = source_key.attnum
    JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
      WITH ORDINALITY AS target_key(attnum, ordinality)
      ON target_key.ordinality = source_key.ordinality
    JOIN pg_catalog.pg_attribute AS target_attribute
      ON target_attribute.attrelid = target_class.oid
     AND target_attribute.attnum = target_key.attnum
    WHERE constraint_row.contype = 'f'
      AND source_namespace.nspname = 'public'
      AND source_class.relname = 'business_representations'
    GROUP BY
      constraint_row.oid,
      constraint_row.conname,
      target_namespace.nspname,
      target_class.relname,
      constraint_row.convalidated,
      constraint_row.condeferrable,
      constraint_row.condeferred,
      constraint_row.confupdtype,
      constraint_row.confdeltype
  ) AS foreign_keys
  WHERE 'current_version_id'::text = ANY(source_columns)
),

relevant_write_locks AS (
  SELECT count(DISTINCT lock_row.pid)::bigint AS blocking_session_count
  FROM pg_catalog.pg_locks AS lock_row
  WHERE lock_row.pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
    AND lock_row.granted
    AND lock_row.locktype = 'relation'
    AND lock_row.relation IN (
      pg_catalog.to_regclass('public.business_representations'),
      pg_catalog.to_regclass('public.representation_versions'),
      pg_catalog.to_regclass('public.audit_events')
    )
    AND lock_row.mode IN (
      'RowExclusiveLock',
      'ShareUpdateExclusiveLock',
      'ShareRowExclusiveLock',
      'ExclusiveLock',
      'AccessExclusiveLock'
    )
),

relationship_inventory AS (
  SELECT
    (SELECT count(*)::bigint
     FROM public.representation_versions AS rv
     LEFT JOIN public.business_representations AS br
       ON br.id = rv.business_representation_id
     WHERE br.id IS NULL) AS orphan_version_count,
    (SELECT count(*)::bigint
     FROM public.representation_versions AS rv
     LEFT JOIN public.representation_versions AS previous_version
       ON previous_version.id = rv.previous_version_id
     WHERE rv.previous_version_id IS NOT NULL
       AND (
         previous_version.id IS NULL
         OR previous_version.business_representation_id
              IS DISTINCT FROM rv.business_representation_id
         OR previous_version.version_number >= rv.version_number
       )) AS malformed_previous_version_count,
    (SELECT count(*)::bigint
     FROM public.representation_versions AS rv
     LEFT JOIN public.representation_proposals AS proposal
       ON proposal.id = rv.source_proposal_id
     WHERE proposal.id IS NULL
        OR proposal.business_representation_id
             IS DISTINCT FROM rv.business_representation_id) AS malformed_source_proposal_count,
    (SELECT count(*)::bigint
     FROM public.representation_versions AS rv
     LEFT JOIN public.approval_decisions AS approval
       ON approval.id = rv.source_approval_id
     WHERE rv.source_approval_id IS NOT NULL
       AND (
         approval.id IS NULL
         OR approval.business_representation_id
              IS DISTINCT FROM rv.business_representation_id
       )) AS malformed_source_approval_count
),

public_experience_table AS (
  SELECT pg_catalog.to_regclass('public.public_experience_sessions')::text
    AS relation_identity
),
public_experience_consistency AS (
  SELECT
    count(*) FILTER (
      WHERE session_row.state IN (
        'zeya_active',
        'zeya_finalized',
        'call_requested',
        'call_correlation_pending',
        'dispatch_resolution_pending',
        'call_dispatched',
        'call_active',
        'completion_processing_failed'
      )
      AND (
        representation_row.id IS NULL
        OR representation_row.business_id IS DISTINCT FROM session_row.business_id
        OR session_row.canonical_version_id
             IS DISTINCT FROM representation_row.current_version_id
      )
    )::bigint AS active_mismatch_count,
    count(*) FILTER (
      WHERE session_row.state = 'expired'
        AND session_row.dispatch_id IS NOT NULL
        AND session_row.veya_voice_context_id IS NOT NULL
        AND session_row.provider_conversation_id IS NOT NULL
        AND session_row.provider_call_id IS NOT NULL
        AND session_row.veya_conversation_output_id IS NULL
        AND (
          representation_row.id IS NULL
          OR representation_row.business_id IS DISTINCT FROM session_row.business_id
          OR session_row.canonical_version_id
               IS DISTINCT FROM representation_row.current_version_id
        )
    )::bigint AS recoverable_expired_mismatch_count,
    count(*) FILTER (
      WHERE session_row.state IN (
        'reflection_ready',
        'call_failed',
        'call_unanswered',
        'call_rejected',
        'call_completed_without_transcript',
        'failed'
      )
      AND (
        representation_row.id IS NULL
        OR representation_row.business_id IS DISTINCT FROM session_row.business_id
        OR session_row.canonical_version_id
             IS DISTINCT FROM representation_row.current_version_id
      )
    )::bigint AS historical_version_divergence_count
  FROM public.public_experience_sessions AS session_row
  LEFT JOIN public.business_representations AS representation_row
    ON representation_row.id = session_row.business_representation_id
),

purge_named_overloads AS (
  SELECT count(*)::bigint AS overload_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_purge_business_representation'
),
purge_catalog AS (
  SELECT
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.regexp_replace(p.prosrc, '[[:space:]]+', '', 'g') AS normalized_body,
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure(
    'public.zeya_purge_business_representation(uuid,uuid)'
  )
),
purge_acl AS (
  SELECT
    COALESCE(
      pg_catalog.array_agg(
        CASE
          WHEN acl_row.grantee = 0 THEN 'PUBLIC'::name
          ELSE role_row.rolname
        END
        ORDER BY
          CASE
            WHEN acl_row.grantee = 0 THEN 'PUBLIC'::name
            ELSE role_row.rolname
          END
      ) FILTER (WHERE acl_row.privilege_type = 'EXECUTE'),
      ARRAY[]::name[]
    ) AS execute_grantees
  FROM purge_catalog AS purge_row
  LEFT JOIN LATERAL pg_catalog.aclexplode(purge_row.proacl) AS acl_row
    ON true
  LEFT JOIN pg_catalog.pg_roles AS role_row
    ON role_row.oid = acl_row.grantee
),
purge_semantics AS (
  SELECT
    count(*) = 1 AS exact_signature_exists,
    COALESCE(bool_and(owner_name = 'postgres'), false) AS owner_is_postgres,
    COALESCE(bool_and(prosecdef), false) AS security_definer,
    COALESCE(
      bool_and(proconfig = ARRAY['search_path=public, auth, pg_temp']::text[]),
      false
    ) AS search_path_exact,
    COALESCE(
      bool_and(
        normalized_body LIKE
          '%set_config(''zeya.controlled_purge'',''on'',true)%'
      ),
      false
    ) AS enables_transaction_local_purge,
    COALESCE(
      bool_and(
        normalized_body LIKE
          '%set_config(''zeya.controlled_purge'',''off'',true)%'
      ),
      false
    ) AS disables_transaction_local_purge,
    max(definition_md5)::text AS definition_md5
  FROM purge_catalog
),
purge_acl_semantics AS (
  SELECT
    'postgres'::name = ANY(execute_grantees) AS postgres_has_execute,
    'service_role'::name = ANY(execute_grantees) AS service_role_has_execute,
    NOT ('PUBLIC'::name = ANY(execute_grantees)) AS public_has_no_execute,
    NOT ('anon'::name = ANY(execute_grantees)) AS anon_has_no_execute,
    NOT ('authenticated'::name = ANY(execute_grantees))
      AS authenticated_has_no_execute,
    COALESCE(
      execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
      false
    ) AS execute_grantees_exact,
    execute_grantees
  FROM purge_acl
),

checks(check_name, passed, details) AS (
  SELECT
    'rpc_not_preexisting'::text,
    count(*) = 0,
    pg_catalog.jsonb_build_object(
      'existing_exact_and_overload_count', count(*)
    )
  FROM atomic_rpc_catalog

  UNION ALL
  SELECT
    'table_representation_versions_structure'::text,
    pg_catalog.to_regclass('public.representation_versions') IS NOT NULL
      AND (SELECT count(*) FROM version_column_diff) = 0
      AND (SELECT count(*) FROM unexpected_version_columns) = 0
      AND (SELECT matching_default_count FROM content_hash_default) = 1,
    pg_catalog.jsonb_build_object(
      'relation', pg_catalog.to_regclass('public.representation_versions')::text,
      'expected_column_count', (SELECT count(*) FROM expected_version_columns),
      'actual_column_count', (
        SELECT count(*) FROM actual_columns
        WHERE table_name = 'representation_versions'
      ),
      'missing_or_mismatched_column_count', (SELECT count(*) FROM version_column_diff),
      'unexpected_column_count', (SELECT count(*) FROM unexpected_version_columns),
      'content_hash_default_exact',
        (SELECT matching_default_count FROM content_hash_default) = 1,
      'content_hash_normalized_default',
        (SELECT normalized_default FROM content_hash_default),
      'content_hash_expected_normalized_default',
        'encode(digest((element_values)::text,''sha256''::text),''hex''::text)'
    )

  UNION ALL
  SELECT
    'table_business_representations_structure'::text,
    pg_catalog.to_regclass('public.business_representations') IS NOT NULL
      AND (SELECT count(*) FROM representation_column_diff) = 0,
    pg_catalog.jsonb_build_object(
      'relation', pg_catalog.to_regclass('public.business_representations')::text,
      'expected_column_count', (SELECT count(*) FROM expected_representation_columns),
      'missing_or_mismatched_column_count', (SELECT count(*) FROM representation_column_diff)
    )

  UNION ALL
  SELECT
    'current_version_pointers_valid'::text,
    dangling_pointer_count = 0,
    pg_catalog.jsonb_build_object(
      'nonnull_pointer_count', nonnull_pointer_count,
      'dangling_pointer_count', dangling_pointer_count
    )
  FROM pointer_inventory

  UNION ALL
  SELECT
    'no_cross_representation_pointers'::text,
    cross_representation_pointer_count = 0,
    pg_catalog.jsonb_build_object(
      'cross_representation_pointer_count', cross_representation_pointer_count
    )
  FROM pointer_inventory

  UNION ALL
  SELECT
    'no_duplicate_version_numbers'::text,
    duplicate_group_count = 0,
    pg_catalog.jsonb_build_object(
      'duplicate_group_count', duplicate_group_count
    )
  FROM duplicate_version_sequences

  UNION ALL
  SELECT
    'version_sequence_uniqueness_constraint'::text,
    exact_unique_count = 1,
    pg_catalog.jsonb_build_object(
      'exact_unique_index_or_constraint_count', exact_unique_count,
      'required_columns', ARRAY['business_representation_id', 'version_number']::text[]
    )
  FROM exact_version_sequence_unique

  UNION ALL
  SELECT
    'representation_versions_immutability_trigger'::text,
    exact_trigger_count = 1,
    pg_catalog.jsonb_build_object(
      'exact_trigger_count', exact_trigger_count,
      'all_user_trigger_count', table_trigger_count,
      'required_trigger_type', 27,
      'required_trigger', 'trg_representation_versions_immutable',
      'required_function', 'public.zeya_block_update_delete()',
      'required_function_owner', 'postgres',
      'required_security_definer', false,
      'required_configuration', NULL
    )
  FROM version_trigger_summary

  UNION ALL
  SELECT
    'audit_events_immutability_protection'::text,
    exact_trigger_count = 1,
    pg_catalog.jsonb_build_object(
      'exact_trigger_count', exact_trigger_count,
      'all_user_trigger_count', table_trigger_count,
      'required_trigger_type', 27,
      'required_trigger', 'trg_audit_events_immutable',
      'required_function', 'public.zeya_block_update_delete()',
      'required_function_owner', 'postgres',
      'required_security_definer', false,
      'required_configuration', NULL
    )
  FROM audit_trigger_summary

  UNION ALL
  SELECT
    'current_version_id_foreign_key'::text,
    exact_fk_count = 1 AND current_version_fk_count = 1,
    pg_catalog.jsonb_build_object(
      'exact_fk_count', exact_fk_count,
      'current_version_fk_count', current_version_fk_count,
      'constraint_name', 'fk_business_representations_current_version',
      'source_columns', ARRAY['current_version_id', 'id']::text[],
      'target_columns', ARRAY['id', 'business_representation_id']::text[],
      'target_table', 'public.representation_versions',
      'deferrable', true,
      'initially_deferred', true,
      'update_action', 'NO ACTION',
      'delete_action', 'NO ACTION'
    )
  FROM current_version_fk

  UNION ALL
  SELECT
    'no_blocking_active_transactions'::text,
    blocking_session_count = 0,
    pg_catalog.jsonb_build_object(
      'relevant_write_lock_session_count', blocking_session_count,
      'scope', 'other sessions holding granted write or exclusive relation locks on canonical pointer tables'
    )
  FROM relevant_write_locks

  UNION ALL
  SELECT
    'no_unexpected_rpc_overloads'::text,
    count(*) = 0,
    pg_catalog.jsonb_build_object(
      'named_overload_count', count(*),
      'identities', COALESCE(
        pg_catalog.array_agg(identity_arguments ORDER BY identity_arguments),
        ARRAY[]::text[]
      )
    )
  FROM atomic_rpc_catalog

  UNION ALL
  SELECT
    'no_malformed_relationships'::text,
    malformed_previous_version_count = 0
      AND malformed_source_proposal_count = 0
      AND malformed_source_approval_count = 0,
    pg_catalog.jsonb_build_object(
      'malformed_previous_version_count', malformed_previous_version_count,
      'malformed_source_proposal_count', malformed_source_proposal_count,
      'malformed_source_approval_count', malformed_source_approval_count
    )
  FROM relationship_inventory

  UNION ALL
  SELECT
    'public_experience_sessions_table_exists'::text,
    relation_identity IS NOT NULL,
    pg_catalog.jsonb_build_object(
      'relation', relation_identity
    )
  FROM public_experience_table

  UNION ALL
  SELECT
    'public_experience_session_consistency'::text,
    active_mismatch_count = 0
      AND recoverable_expired_mismatch_count = 0,
    pg_catalog.jsonb_build_object(
      'active_mismatch_count', active_mismatch_count,
      'recoverable_expired_mismatch_count', recoverable_expired_mismatch_count,
      'historical_version_divergence_count', historical_version_divergence_count
    )
  FROM public_experience_consistency

  UNION ALL
  SELECT
    'lineage_integrity_well_formed'::text,
    orphan_version_count = 0,
    pg_catalog.jsonb_build_object(
      'orphan_version_count', orphan_version_count,
      'relationship', 'representation_versions.business_representation_id -> business_representations.id'
    )
  FROM relationship_inventory

  UNION ALL
  SELECT
    'controlled_purge_compatible'::text,
    purge_semantics.exact_signature_exists
      AND purge_named_overloads.overload_count = 1
      AND purge_semantics.owner_is_postgres
      AND purge_semantics.security_definer
      AND purge_semantics.search_path_exact
      AND purge_acl_semantics.execute_grantees_exact
      AND purge_acl_semantics.postgres_has_execute
      AND purge_acl_semantics.service_role_has_execute
      AND purge_acl_semantics.public_has_no_execute
      AND purge_acl_semantics.anon_has_no_execute
      AND purge_acl_semantics.authenticated_has_no_execute
      AND purge_semantics.enables_transaction_local_purge
      AND purge_semantics.disables_transaction_local_purge,
    pg_catalog.jsonb_build_object(
      'exact_signature_exists', purge_semantics.exact_signature_exists,
      'named_overload_count', purge_named_overloads.overload_count,
      'owner_is_postgres', purge_semantics.owner_is_postgres,
      'security_definer', purge_semantics.security_definer,
      'search_path_exact', purge_semantics.search_path_exact,
      'execute_grantees', purge_acl_semantics.execute_grantees,
      'execute_grantees_exact', purge_acl_semantics.execute_grantees_exact,
      'postgres_has_execute', purge_acl_semantics.postgres_has_execute,
      'service_role_has_execute', purge_acl_semantics.service_role_has_execute,
      'public_has_no_execute', purge_acl_semantics.public_has_no_execute,
      'anon_has_no_execute', purge_acl_semantics.anon_has_no_execute,
      'authenticated_has_no_execute', purge_acl_semantics.authenticated_has_no_execute,
      'transaction_local_enable', purge_semantics.enables_transaction_local_purge,
      'transaction_local_disable', purge_semantics.disables_transaction_local_purge,
      'definition_md5', purge_semantics.definition_md5,
      'known_healthy_definition_md5', '8fb71232dd96059d13bc8000586bebee'
    )
  FROM purge_semantics
  CROSS JOIN purge_named_overloads
  CROSS JOIN purge_acl_semantics
)
SELECT
  check_name::text,
  passed::boolean,
  details::jsonb
FROM checks
ORDER BY check_name;
