import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeConversationCandidateSummary } from "../../lib/voice/conversation-output/extractor";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260718230000_public_experience_governed_learning.sql");
const preflight = read("docs/database/preflight/public_experience_governed_learning_preflight.sql");
const verification = read("docs/database/verification/public_experience_governed_learning_verification.sql");
const rollback = read("docs/database/rollbacks/public_experience_governed_learning_rollback.sql");
const service = read("lib/voice/conversation-output/service.ts");
const reviewRepository = read("lib/voice/conversation-review/repository.ts");

for (const column of [
  "source_public_experience_session_id", "source_voice_conversation_output_id",
  "source_voice_context_id", "source_tenant_user_id", "source_business_id",
  "source_canonical_version_id", "source_mission_id",
  "source_provider_conversation_id", "source_provider_call_id", "source_evidence_id",
]) assert(migration.includes(column), `missing governed-learning column ${column}`);

for (const constraint of [
  "evidence_interaction_provenance_complete",
  "evidence_interaction_output_identity_fk",
  "evidence_interaction_session_identity_fk",
  "voice_candidate_source_evidence_identity_fk",
]) assert(migration.includes(constraint), `missing governed-learning constraint ${constraint}`);

assert(migration.includes("evidence_interaction_output_unique_idx"), "one Evidence per output must be database-unique");
assert(migration.includes("FOR UPDATE"), "output and session processing must be transactionally locked");
assert(migration.includes("v_output.completed_extraction_schema_version = p_extraction_schema_version"), "exact replay identity must remain");
assert(migration.includes("v_output.extraction_result_hash = v_result_hash"), "candidate result hash must remain idempotency authority");
assert(migration.includes("public_experience_governed_learning"), "Evidence creation must create a governed audit identity");
assert(migration.includes("'evidence_created'"), "interaction Evidence must be audited");
assert(migration.includes("'pending_review'"), "governed-learning output must remain pending review");
assert(migration.includes("v_session.canonical_version_id IS DISTINCT FROM v_output.canonical_version_id"), "frozen baseline identity must be exact");
assert(migration.includes("v_session.dispatch_id IS DISTINCT FROM v_lineage.mission_id"), "mission identity must be exact");
assert(migration.includes("v_session.provider_conversation_id IS DISTINCT FROM v_output.conversation_id"), "provider conversation identity must be exact");
assert(migration.includes("v_session.provider_call_id IS DISTINCT FROM v_output.provider_call_id"), "provider call identity must be exact");
assert(migration.includes("v_lineage.authorized_element_keys"), "candidate Element keys must remain lineage-authorized");
assert(migration.includes("current_setting('zeya.governed_learning_write', true)"), "direct interaction Evidence writes must fail closed");
assert(migration.includes("set_config('zeya.governed_learning_write', 'on', true)"), "controlled Evidence creation must be transaction-local");

for (const forbidden of [
  "INSERT INTO public.representation_versions",
  "UPDATE public.business_representations",
  "UPDATE public.representation_elements",
  "INSERT INTO public.approval_decisions",
  "zeya_create_canonical_version",
]) assert(!migration.includes(forbidden), `automatic canonical mutation is forbidden: ${forbidden}`);

assert(!migration.includes("raw_statement, statement_hash"), "generated Evidence hash must not be inserted");
assert(!migration.includes("Authorization"), "authorization data must not be persisted");
assert(!migration.includes("token_hash"), "session tokens must not enter Evidence provenance");
assert(!migration.includes("phone_hash"), "phone identity must not enter Evidence provenance");
assert(!migration.includes("transcript,"), "raw transcript must not be copied into Evidence");
assert(migration.includes("[contact detail]") && migration.includes("[link]"), "database boundary must redact contact details and links");

for (const check of [
  "migration_not_applied", "required_relations_present", "required_columns_present",
  "generated_evidence_hash_exact", "candidate_store_rpc_baseline",
  "candidate_store_rpc_semantics", "object_names_available",
  "controlled_purge_semantics_present",
]) assert(preflight.includes(check), `missing preflight check ${check}`);

assert(preflight.includes("jsonb_build_object"), "preflight diagnostics must be JSONB");
assert(preflight.includes("search_path=\"\""), "candidate baseline must match the deployed empty search_path");
assert(preflight.includes("search_path=public, auth, pg_temp"), "purge baseline must match its deployed search_path");
for (const marker of [
  "exact_signature", "exact_signature_count", "named_overload_count", "owner", "security_definer",
  "prokind", "return_type", "volatility", "configuration", "execute_grantees", "public_execute",
  "anon_execute", "authenticated_execute", "postgres_execute", "service_role_execute",
  "normalized_definition", "definition_md5", "enable_marker", "disable_marker",
]) assert(preflight.includes(marker), `preflight diagnostics missing ${marker}`);
assert(preflight.includes("[[:space:]]+"), "function-body checks must normalize whitespace");
assert(!/^[ \t]*(?:DO|DECLARE|IF|ELSIF|END IF|RAISE|BEGIN|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)[ \t]/m.test(preflight), "preflight must remain read-only SQL");

for (const check of [
  "provenance_columns_exact", "governed_learning_constraints_present",
  "governed_learning_indexes_present", "interaction_evidence_authority_trigger",
  "interaction_evidence_authority_function", "candidate_store_rpc_secure_and_exact",
  "candidate_store_rpc_governed_learning_semantics", "tenant_select_policies_preserved",
  "canonical_state_untouched_by_migration",
]) assert(verification.includes(check), `missing verification check ${check}`);

assert(verification.includes("WITH policy_inventory AS"), "verification must inventory live tenant policies");
assert(verification.includes("WITH policy_inventory AS ("), "verification policy inventory must be read-only");
assert(verification.includes("checks(check_name, passed, details) AS"), "verification must name CTE output columns");
for (const marker of [
  "exact_signature_count", "named_overload_count", "execute_grantees", "public_execute", "anon_execute",
  "authenticated_execute", "postgres_execute", "service_role_execute", "return_type", "volatility",
  "current_user_guard", "transaction_local_setting", "authorization_error", "lineage_mismatch",
  "canonical_versions_insert_absent", "canonical_pointer_update_absent", "element_pointer_update_absent", "approval_insert_absent",
  "evidence_select", "representation_proposals_select", "voice_outputs_tenant_select", "voice_candidates_tenant_select",
]) assert(verification.includes(marker), `verification diagnostics missing ${marker}`);
assert(verification.includes("search_path=\"\""), "verification must match the deployed empty search_path");
assert(!/^[ \t]*(?:DO|DECLARE|IF|ELSIF|END IF|RAISE|BEGIN|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)[ \t]/m.test(verification), "verification must remain read-only SQL");

assert(rollback.includes("Rollback refused: Phase 5A governed-learning records exist"), "rollback must preserve created Evidence");
assert(rollback.includes("CREATE OR REPLACE FUNCTION public.zeya_store_voice_conversation_candidates"), "rollback must restore the exact prior RPC surface");
assert(rollback.includes("NOTIFY pgrst, 'reload schema'"), "rollback must reload PostgREST");
assert(!rollback.includes("CASCADE"), "rollback must not use destructive CASCADE");

assert(service.includes("extractConversationCandidates"), "existing extraction service must remain authoritative");
assert(reviewRepository.includes("sourceEvidenceId"), "review API must expose source Evidence identity");
assert(reviewRepository.includes("publicExperienceSessionId"), "review API must expose source session identity");

const sanitized = sanitizeConversationCandidateSummary(
  "Call +1 (555) 123-4567 or test@example.com and inspect https://example.com/private",
);
assert.equal(
  sanitized,
  "Call [contact detail] or [contact detail] and inspect [link]",
  "candidate summary sanitization must remove contact details and links",
);
assert(sanitizeConversationCandidateSummary("x".repeat(700)).length === 500, "candidate summaries must be bounded");

console.log("Public Experience governed learning static contract — PASS");
