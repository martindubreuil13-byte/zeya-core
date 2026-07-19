import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root=process.cwd();
const migration=readFileSync(path.join(root,"supabase/migrations/20260719120000_voice_candidate_atomic_canonicalization.sql"),"utf8");
const preflight=readFileSync(path.join(root,"supabase/manual/20260719_voice_candidate_atomic_canonicalization_preflight.sql"),"utf8");
const verification=readFileSync(path.join(root,"supabase/manual/20260719_voice_candidate_atomic_canonicalization_verification.sql"),"utf8");
const rollback=readFileSync(path.join(root,"supabase/manual/20260719_voice_candidate_atomic_canonicalization_rollback.sql"),"utf8");

assert.match(migration,/CREATE TABLE public\.conversation_candidate_canonicalizations/);
for(const column of ["promotion_id","review_decision_id","candidate_id","conversation_output_id","voice_context_id","tenant_user_id","business_id","business_representation_id","baseline_canonical_version_id","representation_proposal_id","approval_decision_id","canonical_version_id","confidence_assessment_id","actor_user_id","request_key","request_payload","request_hash"]) assert.match(migration,new RegExp(`\\b${column}\\b`));
for(const unique of ["promotion","candidate","request","proposal","version","confidence"]) assert.match(migration,new RegExp(`conversation_canonicalization_${unique}_unique UNIQUE`));
assert.match(migration,/ENABLE ROW LEVEL SECURITY[\s\S]*tenant_user_id = auth\.uid\(\)/);
assert.match(migration,/BEFORE UPDATE OR DELETE[\s\S]*zeya\.controlled_purge/);
assert.match(migration,/REVOKE ALL ON public\.conversation_candidate_canonicalizations FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration,/GRANT SELECT ON public\.conversation_candidate_canonicalizations TO authenticated, service_role/);
assert.match(migration,/CREATE FUNCTION public\.zeya_promote_voice_candidate_to_canonical\(/);
assert.match(migration,/auth\.role\(\) <> 'service_role'/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.zeya_promote_voice_candidate_to_canonical[\s\S]*FROM PUBLIC, anon, authenticated[\s\S]*GRANT EXECUTE[\s\S]*TO service_role/);
assert.doesNotMatch(migration,/GRANT EXECUTE ON FUNCTION public\.zeya_promote_voice_conversation_candidate_internal/);
const orchestrator=migration.slice(migration.indexOf("CREATE FUNCTION public.zeya_promote_voice_candidate_to_canonical"),migration.indexOf("ALTER FUNCTION public.zeya_promote_voice_candidate_to_canonical"));
for(const marker of ["FOR UPDATE","canonical baseline changed","zeya_promote_voice_conversation_candidate_internal","representation_proposal","INSERT INTO public.approval_decisions","status='approved'","zeya_create_canonical_version_atomic","INSERT INTO public.confidence_assessments","INSERT INTO public.conversation_candidate_canonicalizations","canonicalization request conflicts"]) assert.match(orchestrator,new RegExp(marker.replace(/[.()]/g,"\\$&")));
assert(migration.indexOf("DELETE FROM public.conversation_candidate_canonicalizations")<migration.indexOf("DELETE FROM public.confidence_assessments"));
assert(migration.indexOf("DELETE FROM public.conversation_candidate_canonicalizations")<migration.indexOf("DELETE FROM public.conversation_candidate_promotions"));
assert.match(preflight,/shared_core_present[\s\S]*atomic_writer_present/);
for(const marker of ["immutable_trigger","tenant_select_policy","direct_writes_blocked","orchestrator_service_only","internal_core_postgres_only","shared_core_reference","atomic_writer_reference","stale_baseline_guard","confidence_insert","provenance_insert","controlled_purge"]) assert(verification.includes(marker));
assert.match(rollback,/DROP FUNCTION IF EXISTS public\.zeya_promote_voice_candidate_to_canonical[\s\S]*DROP TABLE IF EXISTS public\.conversation_candidate_canonicalizations/);
console.log("Voice candidate atomic canonicalization static contract — PASS");
