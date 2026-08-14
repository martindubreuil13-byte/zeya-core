-- ZEYA Formation P1 stabilization — read-only preflight
-- Target migration: supabase/migrations/20260806000000_formation_p1_stabilization.sql
-- This artifact contains inspection queries only. It performs no writes and
-- must be run manually by the owner against the intended non-Production project.

-- 1. Required relations.
-- Expected: 10 rows, each with exists = true. Any false value is a hard stop.
WITH required_relations(schema_name, relation_name) AS (
  VALUES
    ('public', 'representation_formation_sessions'),
    ('public', 'representation_proposals'),
    ('public', 'evidence'),
    ('public', 'observations'),
    ('public', 'audit_events'),
    ('public', 'representation_versions'),
    ('public', 'businesses'),
    ('public', 'business_representations'),
    ('public', 'voice_conversation_outputs'),
    ('supabase_migrations', 'schema_migrations')
)
SELECT schema_name, relation_name,
  pg_catalog.to_regclass(pg_catalog.format('%I.%I', schema_name, relation_name)) IS NOT NULL AS exists
FROM required_relations
ORDER BY schema_name, relation_name;

-- 2. Required pre-migration columns used by the migration and replacement RPC.
-- Expected: zero rows. Every returned row is a missing dependency and a hard stop.
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('representation_formation_sessions', 'id'),
    ('representation_formation_sessions', 'business_id'),
    ('representation_formation_sessions', 'business_representation_id'),
    ('representation_formation_sessions', 'owner_id'),
    ('representation_formation_sessions', 'status'),
    ('representation_formation_sessions', 'first_working_conversation_id'),
    ('representation_formation_sessions', 'updated_at'),
    ('representation_proposals', 'id'),
    ('representation_proposals', 'business_representation_id'),
    ('representation_proposals', 'proposed_changes'),
    ('representation_proposals', 'status'),
    ('representation_proposals', 'status_updated_at'),
    ('evidence', 'id'),
    ('evidence', 'business_representation_id'),
    ('evidence', 'source_type'),
    ('evidence', 'source_description'),
    ('evidence', 'raw_statement'),
    ('evidence', 'statement_hash'),
    ('evidence', 'affected_domains'),
    ('evidence', 'captured_by_actor'),
    ('observations', 'id'),
    ('observations', 'business_representation_id'),
    ('observations', 'evidence_id'),
    ('observations', 'interpreted_meaning'),
    ('audit_events', 'business_representation_id'),
    ('audit_events', 'event_type'),
    ('audit_events', 'evidence_id'),
    ('audit_events', 'actor_user_id'),
    ('audit_events', 'details'),
    ('voice_conversation_outputs', 'id'),
    ('voice_conversation_outputs', 'tenant_user_id'),
    ('voice_conversation_outputs', 'business_id'),
    ('voice_conversation_outputs', 'business_representation_id'),
    ('voice_conversation_outputs', 'transcript_status'),
    ('voice_conversation_outputs', 'completed_at'),
    ('businesses', 'id'),
    ('businesses', 'user_id'),
    ('business_representations', 'id'),
    ('business_representations', 'business_id'),
    ('business_representations', 'user_id'),
    ('business_representations', 'current_version_id'),
    ('representation_versions', 'id'),
    ('representation_versions', 'business_representation_id')
)
SELECT required.table_name, required.column_name
FROM required_columns AS required
LEFT JOIN information_schema.columns AS actual
  ON actual.table_schema = 'public'
 AND actual.table_name = required.table_name
 AND actual.column_name = required.column_name
WHERE actual.column_name IS NULL
ORDER BY required.table_name, required.column_name;

-- 3. Required enum values.
-- Expected: all five rows have exists = true. Any false value is a hard stop.
WITH required_enum_values(type_name, enum_label) AS (
  VALUES
    ('formation_session_status', 'working_conversation_pending'),
    ('formation_session_status', 'working_conversation_linked'),
    ('proposal_status', 'draft'),
    ('proposal_status', 'superseded'),
    ('evidence_source_type', 'conversation')
)
SELECT required.type_name, required.enum_label,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS type
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
    JOIN pg_catalog.pg_enum AS enum_value ON enum_value.enumtypid = type.oid
    WHERE namespace.nspname = 'public'
      AND type.typname = required.type_name
      AND enum_value.enumlabel = required.enum_label
  ) AS exists
FROM required_enum_values AS required
ORDER BY required.type_name, required.enum_label;

-- 4. Required pre-migration functions and current identity signatures.
-- Expected: exactly one row per required name. Compare identity_arguments with
-- the expected types shown below; missing or additional overloads require review.
WITH required_functions(function_name, expected_argument_types) AS (
  VALUES
    ('zeya_initiate_formation_session',
      'uuid, uuid, uuid, formation_initiation_source, uuid'),
    ('zeya_advance_formation_status',
      'uuid, uuid, formation_session_status, formation_session_status, jsonb'),
    ('zeya_link_formation_conversation', 'uuid, uuid, uuid, text'),
    ('zeya_set_evidence_statement_hash', '')
)
SELECT required.function_name, required.expected_argument_types,
  procedure.oid IS NOT NULL AS exists,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(procedure.oid) AS result_type,
  procedure.prosecdef AS security_definer,
  procedure.proconfig AS function_settings
FROM required_functions AS required
LEFT JOIN LATERAL (
  SELECT candidate.*
  FROM pg_catalog.pg_proc AS candidate
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = candidate.pronamespace
  WHERE namespace.nspname = 'public'
    AND candidate.proname = required.function_name
) AS procedure ON true
ORDER BY required.function_name;

-- 4a. Existing linkage return shape and required replacement strategy.
-- Expected before migration: current_status_type = text,
-- intended_status_type = formation_session_status,
-- drop_and_recreate_required = true, and unexpected_return_shape = false.
-- An already-enum return is acceptable only if the strengthened P1 body is
-- also reported as already present by check 9a.
WITH linkage_function AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'zeya_link_formation_conversation'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      ILIKE '%uuid%uuid%uuid%text%'
)
SELECT pg_catalog.pg_get_function_result(oid) AS current_return_type,
  pg_catalog.format_type(proallargtypes[7], NULL) AS current_status_type,
  'formation_session_status' AS intended_status_type,
  proallargtypes[7] = 'text'::pg_catalog.regtype::pg_catalog.oid
    AS drop_and_recreate_required,
  NOT (
    proallargtypes[5] = 'uuid'::pg_catalog.regtype::pg_catalog.oid
    AND proallargtypes[6] = 'uuid'::pg_catalog.regtype::pg_catalog.oid
    AND proallargtypes[7] IN (
      'text'::pg_catalog.regtype::pg_catalog.oid,
      'public.formation_session_status'::pg_catalog.regtype::pg_catalog.oid
    )
    AND proallargtypes[8] = 'timestamptz'::pg_catalog.regtype::pg_catalog.oid
    AND proargnames[5:8] = ARRAY[
      'session_id', 'business_representation_id', 'status', 'linked_at'
    ]::text[]
  ) AS unexpected_return_shape
FROM linkage_function;

-- 4b. Objects depending on the linkage function in a way that can block DROP.
-- Expected: zero rows. Routes invoke the RPC dynamically and do not appear here.
WITH linkage_function AS (
  SELECT procedure.oid
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'zeya_link_formation_conversation'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      ILIKE '%uuid%uuid%uuid%text%'
)
SELECT dependency.deptype,
  pg_catalog.pg_describe_object(
    dependency.classid, dependency.objid, dependency.objsubid
  ) AS dependent_object
FROM linkage_function
JOIN pg_catalog.pg_depend AS dependency
  ON dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
 AND dependency.refobjid = linkage_function.oid
ORDER BY dependency.deptype, dependent_object;

-- 5. Evidence integrity/immutability triggers required by correction insertion.
-- Expected: both named triggers exist, are enabled, and are not internal.
WITH required_triggers(trigger_name) AS (
  VALUES
    ('zeya_set_evidence_statement_hash'),
    ('evidence_prevent_modification_trigger')
)
SELECT required.trigger_name,
  trigger.oid IS NOT NULL AS exists,
  trigger.tgenabled,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
FROM required_triggers AS required
LEFT JOIN pg_catalog.pg_trigger AS trigger
  ON trigger.tgname = required.trigger_name
 AND trigger.tgrelid = 'public.evidence'::pg_catalog.regclass
 AND NOT trigger.tgisinternal
ORDER BY required.trigger_name;

-- 6. Partial/already-applied migration detection: new columns.
-- Expected before migration: zero rows. Any row means stop and investigate.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'representation_proposals' AND column_name = 'formation_session_id')
    OR
    (table_name = 'evidence' AND column_name IN (
      'source_formation_session_id',
      'source_formation_proposal_id',
      'source_correction_request_key'
    ))
  )
ORDER BY table_name, column_name;

-- 7. Partial/already-applied migration detection: indexes.
-- Expected before migration: zero rows. Any row means stop and investigate.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'representation_proposals_one_draft_formation_idx',
    'evidence_formation_correction_request_idx'
  )
ORDER BY indexname;

-- 8. Partial/already-applied migration detection: constraint and correction RPC.
-- Expected before migration: zero rows. The existing link RPC is intentionally excluded.
SELECT 'constraint' AS object_type, constraint_name AS object_name
FROM information_schema.table_constraints
WHERE constraint_schema = 'public'
  AND constraint_name = 'evidence_formation_correction_lineage_complete'
UNION ALL
SELECT 'function', procedure.proname
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'zeya_record_formation_owner_correction';

-- 9. Partial/already-applied migration detection: unexpected P1-named triggers.
-- Expected before migration: zero rows. The migration itself creates no trigger.
SELECT table_namespace.nspname AS table_schema,
  table_class.relname AS table_name,
  trigger.tgname AS trigger_name,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
FROM pg_catalog.pg_trigger AS trigger
JOIN pg_catalog.pg_class AS table_class ON table_class.oid = trigger.tgrelid
JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
WHERE NOT trigger.tgisinternal
  AND table_namespace.nspname = 'public'
  AND trigger.tgname ILIKE '%formation%correction%';

-- 9a. Detect whether the strengthened link RPC body was manually installed alone.
-- Expected before migration: both booleans are false. A true value means stop
-- because at least part of the replacement RPC may already be present.
SELECT procedure.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  pg_catalog.pg_get_functiondef(procedure.oid) ILIKE '%output.tenant_user_id = v_session.owner_id%'
    AS has_p1_owner_lineage_check,
  pg_catalog.pg_get_functiondef(procedure.oid) ILIKE '%output.transcript_status = ''finalized''%'
    AS has_p1_finalized_transcript_check
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'zeya_link_formation_conversation';

-- 10. Migration ledger check.
-- Expected before migration: zero rows. Any row means the migration is recorded.
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version = '20260806000000';

-- 11. Malformed Proposal Formation metadata that the backfill will deliberately skip.
-- Expected: zero rows. Any row needs manual review before migration.
WITH proposal_references AS (
  SELECT id, proposed_changes->'_metadata'->>'formationSessionId' AS formation_reference
  FROM public.representation_proposals
  WHERE proposed_changes->'_metadata'->>'formationSessionId' IS NOT NULL
)
SELECT id AS proposal_id, formation_reference
FROM proposal_references
WHERE formation_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ORDER BY id;

-- 12. Proposal Formation references that cannot resolve to a Formation session.
-- Expected: zero rows. Any row would make the FK backfill unsafe.
WITH valid_references AS (
  SELECT id, business_representation_id,
    lower(proposed_changes->'_metadata'->>'formationSessionId') AS formation_reference
  FROM public.representation_proposals
  WHERE proposed_changes->'_metadata'->>'formationSessionId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
SELECT reference.id AS proposal_id,
  reference.business_representation_id AS proposal_representation_id,
  reference.formation_reference
FROM valid_references AS reference
LEFT JOIN public.representation_formation_sessions AS formation
  ON formation.id::text = reference.formation_reference
 AND formation.business_representation_id = reference.business_representation_id
WHERE formation.id IS NULL
ORDER BY reference.id;

-- 13. Duplicate draft summaries that would violate the new partial unique index.
-- Expected: zero rows. Any row is a hard stop; do not delete automatically.
WITH valid_draft_references AS (
  SELECT id, lower(proposed_changes->'_metadata'->>'formationSessionId') AS formation_reference
  FROM public.representation_proposals
  WHERE status = 'draft'
    AND proposed_changes->'_metadata'->>'formationSessionId'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
SELECT formation_reference, count(*) AS draft_count,
  pg_catalog.array_agg(id ORDER BY id) AS proposal_ids
FROM valid_draft_references
GROUP BY formation_reference
HAVING count(*) > 1
ORDER BY formation_reference;

-- 14. Existing rows resembling Formation corrections before lineage columns exist.
-- Expected: zero rows. Any row is not automatically a uniqueness conflict, but must
-- be reviewed because it cannot carry the new request-key lineage retroactively.
SELECT id, business_representation_id, source_type, source_description, created_at
FROM public.evidence
WHERE source_description = 'Owner correction during Formation review'
ORDER BY created_at, id;

-- 15. Current lifecycle and canonical-boundary counts.
-- Expected: informational. Record these values for comparison after migration.
SELECT
  (SELECT count(*) FROM public.representation_formation_sessions) AS formation_sessions,
  (SELECT count(*) FROM public.representation_formation_sessions
    WHERE status = 'working_conversation_pending') AS pending_formations,
  (SELECT count(*) FROM public.representation_formation_sessions
    WHERE status = 'working_conversation_linked') AS linked_formations,
  (SELECT count(*) FROM public.representation_formation_sessions
    WHERE status = 'working_conversation_linked'
      AND first_working_conversation_id IS NULL) AS linked_without_conversation,
  (SELECT count(*) FROM public.representation_proposals
    WHERE status = 'draft') AS draft_proposals,
  (SELECT count(*) FROM public.representation_versions) AS representation_versions,
  (SELECT count(*) FROM public.business_representations
    WHERE current_version_id IS NOT NULL) AS canonical_pointers;

-- 16. Formation/Business/Representation lineage consistency.
-- Expected: zero rows. Any row is a hard stop.
SELECT formation.id AS formation_session_id,
  formation.owner_id,
  formation.business_id,
  formation.business_representation_id
FROM public.representation_formation_sessions AS formation
LEFT JOIN public.businesses AS business
  ON business.id = formation.business_id
 AND business.user_id = formation.owner_id
LEFT JOIN public.business_representations AS representation
  ON representation.id = formation.business_representation_id
 AND representation.business_id = formation.business_id
 AND representation.user_id = formation.owner_id
WHERE business.id IS NULL OR representation.id IS NULL
ORDER BY formation.id;

-- 17. Current RLS state for every table touched or trusted by the migration.
-- Expected: informational; relrowsecurity should be true for owner/governance tables.
WITH inspected_tables(table_name) AS (
  VALUES
    ('representation_formation_sessions'), ('representation_proposals'),
    ('evidence'), ('observations'), ('audit_events'), ('representation_versions'),
    ('businesses'), ('business_representations'), ('voice_conversation_outputs')
)
, public_tables AS (
  SELECT table_class.*
  FROM pg_catalog.pg_class AS table_class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
)
SELECT inspected.table_name,
  public_tables.relrowsecurity AS rls_enabled,
  public_tables.relforcerowsecurity AS rls_forced
FROM inspected_tables AS inspected
LEFT JOIN public_tables ON public_tables.relname = inspected.table_name
ORDER BY inspected.table_name;

-- 18. Current RLS policies for the inspected tables.
-- Expected: informational. Review roles, commands, USING, and WITH CHECK scopes.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'representation_formation_sessions', 'representation_proposals',
    'evidence', 'observations', 'audit_events', 'representation_versions',
    'businesses', 'business_representations', 'voice_conversation_outputs'
  )
ORDER BY tablename, policyname;

-- 19. Current table ACLs for mutation-sensitive Formation/governance tables.
-- Expected: informational. authenticated should not have direct Formation mutation
-- rights; immutable Evidence/Version/Audit mutation rights require careful review.
SELECT grantor, grantee, table_schema, table_name, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'representation_formation_sessions', 'representation_proposals',
    'evidence', 'observations', 'audit_events', 'representation_versions',
    'voice_conversation_outputs'
  )
ORDER BY table_name, grantee, privilege_type;

-- 20. Current Formation RPC ACLs and properties.
-- Expected: Formation lifecycle RPCs are SECURITY DEFINER with an empty search_path;
-- service_role has EXECUTE and PUBLIC/anon/authenticated do not.
SELECT procedure.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  procedure.prosecdef AS security_definer,
  procedure.proconfig AS function_settings,
  pg_catalog.has_function_privilege(
    'service_role', procedure.oid, 'EXECUTE'
  ) AS service_role_execute,
  pg_catalog.has_function_privilege(
    'authenticated', procedure.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'anon', procedure.oid, 'EXECUTE'
  ) AS anon_execute,
  EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname IN (
    'zeya_initiate_formation_session',
    'zeya_advance_formation_status',
    'zeya_link_formation_conversation'
  )
ORDER BY procedure.proname,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid);
