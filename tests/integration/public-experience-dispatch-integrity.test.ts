import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MockProvider } from "../../lib/providers/mock-provider";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("app/api/experience/delegate-call/route.ts");
const dispatcher = read("lib/workers/worker-dispatcher.ts");
const migration = read("supabase/migrations/20260717120000_public_experience_dispatch_integrity.sql");
const preflight = read("docs/database/preflight/public_experience_dispatch_integrity_preflight.sql");
const verification = read("docs/database/verification/public_experience_dispatch_integrity_verification.sql");
const rollback = read("docs/database/rollbacks/public_experience_dispatch_integrity_rollback.sql");

async function main() {
const rawPhone = "+15550004242";
const provider = new MockProvider();
const providerResult = await provider.dispatch({
  workerBriefId: "brief-test",
  missionId: "mission-test",
  targetName: "Visitor",
  targetPhone: rawPhone,
  objective: "Test transient provider target",
  dynamicVariables: { hasTargetPhone: true },
});
assert.equal(providerResult.status, "SIMULATED", "transient provider request receives an E.164 target");
assert(providerResult.providerCallId, "MOCK retains its provider call identity");
assert(providerResult.conversationId, "MOCK retains a synthetic conversation identity");
const secondMock = await provider.dispatch({ workerBriefId: "brief-test-2", missionId: "mission-test-2", targetName: null, targetPhone: rawPhone, objective: "second", dynamicVariables: {} });
assert.notEqual(secondMock.conversationId, providerResult.conversationId, "MOCK conversation identity is unique");

const dynamicBlock = route.slice(route.indexOf("dynamicVariables: {"), route.indexOf("const provider:"));
assert(dynamicBlock.includes("hasTargetPhone: true"), "persisted brief records only target presence");
assert(!dynamicBlock.includes("targetPhone"), "persisted dynamic variables omit plaintext phone");
assert(!dynamicBlock.includes("phone,"), "persisted dynamic variables omit the request phone");
assert(route.includes("{ transientTargetPhone: phone }"), "raw E.164 phone crosses only the transient dispatcher boundary");
assert(dispatcher.includes("saveWorkerBrief(brief, businessId, targetName, persistedTargetPhone)"), "repository receives only the persisted target");
assert(dispatcher.includes("options.transientTargetPhone ?? persistedTargetPhone"), "ordinary authenticated target persistence remains the default");

for (const boundary of ["voiceContextId", "conversationId", "providerCallId"]) {
  assert(dispatcher.includes(boundary), `dispatcher retains ${boundary}`);
  assert(route.includes(boundary), `route retains ${boundary}`);
}
for (const outcome of ["REJECTED", "ACCEPTED_PENDING_CORRELATION", "ACCEPTED_CORRELATED"]) {
  assert(dispatcher.includes(outcome), `typed dispatcher includes ${outcome}`);
}
for (const state of ["call_requested", "call_correlation_pending", "call_dispatched"]) {
  assert(migration.includes(state), `migration includes ${state}`);
}
assert(route.includes('session.state === "call_correlation_pending"'));
assert(route.includes('session.state === "call_requested"'));
assert(route.includes("recoverCorrelation(db, session)"), "uncertain replay attempts recovery rather than redispatch");
assert(route.includes("zeya_reset_public_experience_call_request"), "confirmed rejection restores retryability");
assert(route.includes('return response("correlation_pending", false, 202)'), "uncertain acceptance is not ordinary success");
assert(route.includes('response("dispatch_resolution_pending", false, 202)'), "rejected reset failure is distinct from provider acceptance");
assert(route.includes("!result.providerCallId || !result.conversationId"), "incomplete provider identity never enters correlation_pending");
assert(route.includes('["call_dispatched", "call_active", "reflection_ready"]'), "only durable dispatch states replay as success");
assert(route.includes("session.phone_hash !== phoneHash"), "different-phone replay remains a conflict");

for (const rpc of [
  "zeya_reset_public_experience_call_request",
  "zeya_record_public_experience_provider_acceptance",
]) {
  assert(migration.includes(`CREATE FUNCTION public.${rpc}`));
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION public.${rpc}`));
  assert(rollback.includes(`DROP FUNCTION IF EXISTS public.${rpc}`));
}
assert(migration.includes("SET search_path = ''"));
assert(migration.includes("auth.role() <> 'service_role'") || migration.includes("auth.role()<>'service_role'"));
assert(migration.includes("l.provider_call_id=v.provider_call_id"), "dispatch success requires attached lineage IDs");
assert(migration.includes("l.conversation_id=v.provider_conversation_id"), "dispatch success requires attached conversation identity");
assert(migration.includes("p_provider_call_id IS NULL OR btrim(p_provider_call_id)=''"));
assert(migration.includes("p_provider_conversation_id IS NULL OR btrim(p_provider_conversation_id)=''"));
const acceptance = migration.slice(migration.indexOf("zeya_record_public_experience_provider_acceptance"), migration.indexOf("CREATE OR REPLACE FUNCTION public.zeya_request"));
const request = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.zeya_request"), migration.indexOf("CREATE OR REPLACE FUNCTION public.zeya_record_public_experience_dispatch"));
const correlation = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.zeya_record_public_experience_dispatch"), migration.indexOf("REVOKE ALL"));
assert(!acceptance.includes("v.expires_at<=now()"), "reserved dispatch acceptance remains durable after expiry");
assert(!correlation.includes("v.expires_at<=now()"), "reserved dispatch correlation remains durable after expiry");
assert(request.includes("v.expires_at<=now()"), "new requests remain blocked after expiry");
assert(request.includes("v.phone_hash<>p_phone_hash"), "requested phone cannot change");
for (const state of ["zeya_active", "zeya_finalized", "call_requested", "call_dispatched", "call_active"]) {
  assert(preflight.includes(`state='${state}'`), `preflight counts incompatible ${state} rows`);
}
for (const check of ["phase_4a_table_exact", "phase_4a_state_constraint_exact", "phase_4a_rpcs_exact_and_secure", "phase_4a_table_security", "phase_4a_mutation_trigger", "phase_4a_trigger_function", "phase_4b2_no_collisions", "no_incompatible_active_rows", "no_incompatible_terminal_dispatch_rows", "controlled_purge_compatible"]) assert(preflight.includes(check), `preflight includes ${check}`);
for (const sql of [preflight, verification]) {
  assert(sql.includes("regexp_matches"), "state values are extracted independently of formatting");
  assert(sql.includes("missing_states") && sql.includes("unexpected_states"), "state comparison remains bidirectional");
  assert(sql.includes("to_regprocedure('public.zeya_request_public_experience_call(text,text,text)')"), "request RPC uses exact procedure identity");
  assert(sql.includes("to_regprocedure('public.zeya_record_public_experience_dispatch(text,text,uuid,text)')"), "correlation RPC uses exact procedure identity");
  assert(sql.includes("t.tgtype::int=31"), "trigger semantics use exact catalog flags");
  assert(sql.includes("t.tgfoid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')"), "trigger function identity is exact");
  assert(sql.includes("regexp_replace(p.prosrc,'\\s','','g')"), "function-body checks normalize whitespace");
  assert(sql.includes("ARRAY['search_path=\"\"']::text[]"), "empty search path uses actual proconfig representation");
  assert(sql.includes("ARRAY['search_path=public, auth, pg_temp']::text[]"), "purge search path is exact");
}
assert(verification.includes("dispatch_resolution_pending"), "new exact state set includes dispatch resolution pending");
assert(verification.includes("mutation_rpcs_exact_and_secure"));
assert(verification.includes("controlled_purge_compatible"));
assert(verification.includes("zeya.controlled_purge"));
assert(verification.includes("provider_identity_transitions_exact"));
assert(rollback.includes("provider_call_id IS NOT NULL"));
for (const state of ["call_correlation_pending", "call_dispatched", "call_active"]) assert(rollback.includes(state));
for (const signature of ["(TEXT,TEXT,TEXT)", "(TEXT,TEXT,UUID,TEXT)", "(TEXT,TEXT)", "(TEXT,TEXT,UUID,TEXT,TEXT)"]) {
  assert(migration.includes(`FROM PUBLIC, anon, authenticated, service_role`));
  assert(migration.includes(signature));
}
assert(migration.includes("l.business_id=v.business_id") && migration.includes("l.business_representation_id=v.business_representation_id") && migration.includes("l.canonical_version_id=v.canonical_version_id"), "tenant and canonical lineage remain exact");
assert(!route.includes("console."), "route logs no phone, token, transcript, secret, or canonical context");

console.log("Public Experience dispatch integrity static contract — PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dispatch integrity test failed");
  process.exitCode = 1;
});
