import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260715120000_conversation_review_and_promotion.sql");
const purge = read("supabase/migrations/20260715121000_conversation_review_controlled_purge_patch.sql");
const actorRepair = read("supabase/migrations/20260716100000_conversation_review_actor_uuid_repair.sql");
const parityRepair = read("supabase/migrations/20260716103000_conversation_review_canonical_insert_parity_repair.sql");
const preflight = read("docs/database/preflight/conversation_review_and_promotion_preflight.sql");
const parityPreflight = read("docs/database/preflight/conversation_review_canonical_insert_parity_repair_preflight.sql");
const baseline = read("docs/database/preflight/phase2_purge_baseline.sql");
const route = read("app/api/voice/conversation-review/route.ts");
const panel = read("components/briefing-room/ConversationReviewPanel.tsx");

for (const required of [
  "conversation_candidate_review_decisions", "conversation_candidate_promotions",
  "zeya_review_voice_conversation_candidate", "zeya_promote_voice_conversation_candidate",
  "SECURITY DEFINER SET search_path=''", "FOR UPDATE", "accepted_for_promotion",
  "candidate already promoted", "candidate review is terminal", "conversation review history is immutable",
  "candidate ID is required", "review decision is required", "promotion target is required",
  "request key is required", "confirmed content is required", "Evidence source type is required",
  "jsonb_array_elements(c.source_reference->'turnIndexes')", "jsonb_array_length(o.transcript)",
  "turn_index_numeric numeric", "numeric_value_out_of_range", "turn_index_numeric>2147483647",
  "Evidence source turn index is invalid", "Evidence source turn index is out of range",
  "Evidence source turn indexes must be unique", "Evidence source transcript turn is invalid",
  "Evidence source speaker does not match transcript turn", "ARRAY[p_related_element_id::text]",
  "requires_approval,status", "true,'pending_approval'",
  "statement text; actor uuid; reason text;", "actor:=auth.uid();",
]) assert.ok(migration.includes(required), `missing migration contract: ${required}`);
assert.ok(!migration.includes("actor text;"), "promotion actor must not be text");
assert.ok(!migration.includes("auth.uid()::text"), "promotion actor must not cast UUID to text");
for (const required of ["CREATE OR REPLACE FUNCTION public.zeya_promote_voice_conversation_candidate", "statement text; actor uuid; reason text;", "actor:=auth.uid();", "REVOKE ALL ON FUNCTION", "GRANT EXECUTE ON FUNCTION"]) {
  assert.ok(actorRepair.includes(required), `missing actor repair contract: ${required}`);
}
for (const sql of [migration, parityRepair]) {
  assert.ok(sql.includes("INSERT INTO public.evidence(business_representation_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)"), "Evidence insert must match canonical adapter");
  assert.ok(!sql.includes("INSERT INTO public.evidence(id,"), "default Evidence ID must not be inserted");
  assert.ok(!sql.includes("raw_statement,statement_hash"), "generated Evidence hash must not be inserted");
  assert.ok(sql.includes("INSERT INTO public.representation_proposals(business_representation_id,proposed_changes,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale)"), "Proposal insert must match deployed schema");
  assert.ok(!sql.includes("affected_element_ids,proposed_changes"), "Proposal array columns must not be inserted");
  assert.ok(!sql.includes("supporting_observation_ids"), "Proposal supporting Observation array must not be inserted");
  assert.ok(!sql.includes("supporting_evidence_ids"), "Proposal supporting Evidence array must not be inserted");
}
for (const link of ["proposal_evidence", "proposal_observations", "proposal_elements"]) {
  assert.ok(parityRepair.includes(`INSERT INTO public.${link}`), `relationship insert must be preserved: ${link}`);
}
const functionBody = (sql: string) => {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.zeya_promote_voice_conversation_candidate");
  const endMarker = "END; $$;";
  const end = sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end >= 0, "promotion function body must exist");
  return sql.slice(start, end + endMarker.length);
};
const restoredParityBody = functionBody(parityRepair)
  .replace(
    "INSERT INTO public.evidence(business_representation_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)\n VALUES(c.business_representation_id,p_evidence_source_type,'Founder-confirmed conversation promotion',statement,ARRAY[]::text[],actor)",
    "INSERT INTO public.evidence(id,business_representation_id,source_type,source_description,raw_statement,statement_hash,affected_domains,captured_by_actor)\n VALUES(gen_random_uuid(),c.business_representation_id,p_evidence_source_type,'Founder-confirmed conversation promotion',statement,encode(extensions.digest(statement,'sha256'),'hex'),ARRAY[]::text[],actor)",
  )
  .replace(
    "INSERT INTO public.representation_proposals(business_representation_id,proposed_changes,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale)\n  VALUES(c.business_representation_id,jsonb_build_object(element.element_key,jsonb_build_object('before',NULL,'after',statement)),'high',element.field_sensitivity,true,'pending_approval',actor,coalesce(reason,'Founder-confirmed conversation promotion'))",
    "INSERT INTO public.representation_proposals(business_representation_id,affected_element_ids,proposed_changes,supporting_observation_ids,supporting_evidence_ids,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale)\n  VALUES(c.business_representation_id,ARRAY[element.id],jsonb_build_object(element.element_key,jsonb_build_object('before',NULL,'after',statement)),ARRAY[v_observation_id],ARRAY[v_evidence_id],'high',element.field_sensitivity,true,'pending_approval',actor,coalesce(reason,'Founder-confirmed conversation promotion'))",
  );
assert.equal(restoredParityBody, functionBody(actorRepair), "parity repair must change only the two proven insert contracts");
for (const required of [
  "JOIN pg_type t ON t.oid=a.atttypid",
  "JOIN pg_namespace tn ON tn.oid=t.typnamespace",
  "t.typcategory::text AS type_category",
  "tn.nspname AS type_schema",
  "t.typname AS type_name",
  "'pg_catalog','uuid'",
  "'pg_catalog','_text'",
  "'public','evidence_source_type'",
  "'public','risk_tier'",
  "'public','field_sensitivity_class'",
  "'public','proposal_status'",
]) assert.ok(parityPreflight.includes(required), `missing stable exact-type preflight contract: ${required}`);
assert.equal((parityPreflight.match(/pg_catalog\.format_type/g) ?? []).length, 1, "format_type must be inventory-only");
assert.ok(
  parityPreflight.indexOf("pg_catalog.format_type") > parityPreflight.indexOf("-- Exact catalog inventory"),
  "format_type must not participate in exact type comparison",
);
for (const required of [
  "unnest(con.conkey,con.confkey) WITH ORDINALITY",
  "array_agg(sa.attname ORDER BY keys.ordinality)",
  "array_agg(ta.attname ORDER BY keys.ordinality)",
  "ARRAY['proposal_id','business_representation_id']",
  "ARRAY['evidence_id','business_representation_id']",
  "ARRAY['observation_id','business_representation_id']",
  "ARRAY['element_id','business_representation_id']",
  "ARRAY['id','business_representation_id']",
  "'representation_proposals'",
  "'evidence'",
  "'observations'",
  "'representation_elements'",
  "'c'",
  "'r'",
]) assert.ok(parityPreflight.includes(required), `missing exact composite-FK preflight contract: ${required}`);
assert.ok(
  parityPreflight.includes("SELECT source_table,source_columns,target_table,target_columns,delete_action FROM expected_relationship_keys") &&
    parityPreflight.includes("SELECT source_table,source_columns,target_table,target_columns,delete_action FROM actual_relationship_keys"),
  "composite foreign keys must use exact bidirectional set comparison",
);
for (const identity of [
  "ARRAY['proposal_id','evidence_id']",
  "ARRAY['proposal_id','observation_id']",
  "ARRAY['proposal_id','element_id']",
]) assert.ok(parityPreflight.includes(identity), `missing exact relationship uniqueness identity: ${identity}`);

const validationOffset = migration.indexOf("valid source references are required for Evidence");
const decisionInsertOffset = migration.indexOf("INSERT INTO public.conversation_candidate_review_decisions", migration.indexOf("CREATE FUNCTION public.zeya_promote"));
assert.ok(validationOffset > 0 && validationOffset < decisionInsertOffset, "source validation must precede all promotion writes");
assert.ok(!migration.includes("p_observation_classification"));
assert.ok(!migration.includes("observationClassification"));
for (const forbidden of ["approval_decisions", "representation_versions", "confidence_assessments", "audit_events"]) {
  assert.ok(!migration.includes(`INSERT INTO public.${forbidden}`), `promotion must not write canonical state: ${forbidden}`);
}
for (const required of ["Omitted required target columns", "Required enum labels", "Required primary keys", "Exact relationship foreign keys", "Relationship uniqueness", "extensions.digest(text,text)", "udt_schema", "udt_name", "confrelid", "confkey", "confdeltype"]) {
  assert.ok(preflight.includes(required), `missing preflight contract: ${required}`);
}
for (const exactType of ["'_text'", "'evidence_source_type'", "'risk_tier'", "'field_sensitivity_class'", "'proposal_status'", "'int2'", "'bool'"]) assert.ok(preflight.includes(exactType), `missing exact type identity: ${exactType}`);
for (const relation of ["'proposal_evidence','proposal_id','public','representation_proposals','id'", "'proposal_observations','observation_id','public','observations','id'", "'proposal_elements','element_id','public','representation_elements','id'"]) assert.ok(preflight.includes(relation), `missing exact relationship: ${relation}`);
for (const required of ["pg_get_functiondef", "definition_md5", "function_owner", "security_definer", "function_configuration", "function_acl"]) assert.ok(baseline.includes(required));
assert.match(purge, /DELETE FROM public\.conversation_candidate_promotions[\s\S]*DELETE FROM public\.conversation_candidate_review_decisions[\s\S]*DELETE FROM public\.voice_conversation_candidates/);
for (const contract of ["Provider-attested", "Authenticated client relay", "Mark duplicate", "Confirm promotion", "Related Representation Element", "Optional review reason"]) assert.ok(panel.includes(contract), `missing review UI contract: ${contract}`);
for (const contract of ["Conversation candidate not found", "Review action conflicts with existing history", 'code === "22023"']) assert.ok(route.includes(contract));
console.log("Conversation Review migration static — PASS");
