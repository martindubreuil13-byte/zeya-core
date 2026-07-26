import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createExperienceToken, hashExperienceToken, isPlausibleExperienceToken } from "../../lib/experience/public-session-server";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260716120000_public_experience_sessions.sql");
const reflectionGuardMigration = read("supabase/migrations/20260721000000_fix_reflection_ready_guard.sql");
const representationBriefMigration = read("supabase/migrations/20260721100000_public_experience_representation_brief.sql");
const createRoute = read("app/api/experience/session/route.ts");
const finalizeRoute = read("app/api/experience/session/finalize-zeya/route.ts");
const statusRoute = read("app/api/experience/session/status/route.ts");
const delegationRoute = read("app/api/experience/delegate-call/route.ts");
const webhook = read("lib/voice/events/elevenlabs-event-processor.ts");
const preflight = read("docs/database/preflight/public_experience_sessions_preflight.sql");
const verification = read("docs/database/verification/public_experience_sessions_verification.sql");
const rollback = read("docs/database/rollbacks/public_experience_sessions_rollback.sql");

const token = createExperienceToken();
assert.equal(isPlausibleExperienceToken(token), true, "public token is 256-bit base64url");
assert.match(hashExperienceToken(token), /^[0-9a-f]{64}$/, "only SHA-256 token hash is persisted");
assert(!migration.includes("public_token"), "migration does not store the raw public token");
assert(migration.includes("zeya_create_public_experience_session"), "session and Zeya lineage use one transactional RPC");
assert(migration.includes("zeya_create_voice_representation_lineage"), "creation RPC persists exact voice lineage");
assert(migration.includes("zeya_finalize_public_experience_zeya"), "Zeya finalization transition exists");
assert(migration.includes("zeya_record_public_experience_dispatch"), "separate Veya lineage correlation exists");
assert(migration.includes("zeya_complete_public_experience_call"), "provider-owned completion transition exists");
assert(migration.includes("GRANT SELECT ON public.public_experience_sessions TO service_role"), "only service SELECT is granted");
assert(!migration.includes("TO anon"), "anonymous role receives no table or RPC grant");
assert(createRoute.includes("ZEYA_EXPERIENCE_BUSINESS_ID"), "Business identity is server configured");
assert(!createRoute.includes("businessId = body"), "caller cannot select Business identity");
assert(finalizeRoute.includes('transcriptTrustLevel: "authenticated_client_relay"'), "browser transcript trust is constrained");
assert(finalizeRoute.includes("providerAttested: false"), "browser cannot claim provider attestation");
assert(statusRoute.includes("publicSessionState"), "status route returns mapped public state");
assert(!statusRoute.includes("voice_context_id"), "status route exposes no Voice Context ID");
assert(delegationRoute.includes("findExperienceSession"), "handoff resolves identity from durable session");
assert(!delegationRoute.includes("body.dispatchId"), "browser cannot select a dispatch ID");
assert(webhook.includes("zeya_complete_public_experience_call"), "provider webhook owns completion");
assert(migration.includes("zeya_fail_public_experience_session"), "credential failure has a durable failed transition");
assert(createRoute.includes("zeya_fail_public_experience_session"), "credential failure compensation is invoked");
assert(
  !reflectionGuardMigration.includes("CREATE TABLE") &&
    !reflectionGuardMigration.includes("zeya_persist_public_experience_representation_brief"),
  "reflection-ready guard does not pre-create the canonical representation-brief contract",
);
assert(
  representationBriefMigration.includes("CREATE TABLE public.public_experience_representation_briefs") &&
    representationBriefMigration.includes("CREATE FUNCTION public.zeya_persist_public_experience_representation_brief"),
  "representation-brief migration exclusively owns its table and persistence RPC",
);
for (const required of ["check_name", "passed", "pg_get_functiondef", "definition_md5", "dependency_columns_exact", "object_collisions", "purge_md5_pinned", "8fb71232dd96059d13bc8000586bebee", "EXCEPT"]) assert(preflight.includes(required), `preflight includes ${required}`);
const foreignKeySection = preflight.slice(preflight.indexOf("expected_fk("), preflight.indexOf("expected_functions("));
for (const required of [
  "target_schema",
  "ARRAY['submitted_by']",
  "ARRAY['voice_context_id']",
  "ARRAY['voice_context_id', 'tenant_user_id', 'business_id', 'business_representation_id', 'canonical_version_id']",
  "ARRAY['business_id', 'tenant_user_id']",
  "ARRAY['business_representation_id', 'business_id']",
  "ARRAY['canonical_version_id', 'business_representation_id']",
  "ARRAY['business_id']",
  "ARRAY['business_representation_id']",
  "ARRAY['canonical_version_id']",
  "ARRAY['tenant_user_id']",
  "'auth', 'users'",
  "'public', 'businesses'",
  "'public', 'business_representations'",
  "'public', 'representation_versions'",
  "'public', 'voice_representation_lineage'",
  "'a'",
  "'c'",
  "'r'",
]) assert(foreignKeySection.includes(required), `foreign-key baseline includes ${required}`);
assert.equal((foreignKeySection.match(/^\s*\('voice_/gm) ?? []).length, 10, "foreign-key baseline contains exactly ten expected contracts");
assert(/missing_fk[\s\S]*SELECT \* FROM expected_fk[\s\S]*EXCEPT[\s\S]*SELECT \* FROM actual_fk/.test(foreignKeySection), "foreign-key comparison detects missing contracts");
assert(/unexpected_fk[\s\S]*SELECT \* FROM actual_fk[\s\S]*EXCEPT[\s\S]*SELECT \* FROM expected_fk/.test(foreignKeySection), "foreign-key comparison detects unexpected contracts");
assert(!/to_jsonb\s*\(\s*record\b/i.test(preflight), "preflight never serializes an anonymous record with to_jsonb");
assert(!/array_agg\s*\(\s*record\b/i.test(preflight), "preflight never aggregates anonymous records");
assert(!/::\s*reg(?:class|procedure)\b/i.test(preflight), "preflight does not carry regclass or regprocedure datums into diagnostics");
for (const match of preflight.matchAll(/to_reg(?:class|procedure)\s*\([^)]*\)(?:::text)?/gi)) {
  const context = preflight.slice(Math.max(0, match.index - 100), match.index + match[0].length);
  if (/jsonb_build_object/i.test(context)) assert(match[0].endsWith("::text"), "nullable catalog identity is plain text before JSON serialization");
}
for (const required of ["columns_exact", "no_plaintext_columns", "table_security", "mutation_functions_exact_and_secure", "controlled_trigger_exact", "EXCEPT", 'search_path=\\"\\"']) assert(verification.includes(required), `verification includes ${required}`);
for (const forbidden of ["::regclass", "::regprocedure", "to_regclass", "to_regprocedure", "to_jsonb(", "jsonb_agg(", "array_agg(actual_", "array_agg(expected_"]) {
  assert(!verification.toLowerCase().includes(forbidden), `verification rejects unsafe catalog expression ${forbidden}`);
}
for (const required of [
  "target_relation AS",
  "FROM pg_catalog.pg_class AS c",
  "JOIN pg_catalog.pg_namespace AS n",
  "target.relation_oid",
  "constraint_row.conrelid <> 0",
  "table_exists_exactly_once",
  "index_structure_counts",
  "missing_columns",
  "unexpected_columns",
  "missing_indexes",
  "unexpected_indexes",
  "missing_fk",
  "unexpected_fk",
  "missing_checks",
  "unexpected_checks",
  "expected_count",
  "actual_count",
  "missing_count",
  "unexpected_count",
]) assert(verification.includes(required), `verification includes safe exact check ${required}`);
assert(!/^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|NOTIFY)\b/im.test(verification), "verification remains read-only");
assert(!verification.includes("'public_response_contract',true"),"public response safety is not hardcoded as a passing catalog check");
const mutationFunctions=["zeya_create_public_experience_session","zeya_finalize_public_experience_zeya","zeya_request_public_experience_call","zeya_record_public_experience_dispatch","zeya_complete_public_experience_call","zeya_fail_public_experience_session"];
for(const name of mutationFunctions){assert(migration.includes(`CREATE FUNCTION public.${name}`),`${name} created`);assert(rollback.includes(`DROP FUNCTION public.${name}`),`${name} rolled back`);}
assert(rollback.includes("BEGIN;")&&rollback.includes("COMMIT;")&&rollback.includes("Rollback refused")&&!rollback.includes("CASCADE"),"rollback is transactional, fail-closed, and narrow");

console.log("Public Experience foundation static checks — PASS");
