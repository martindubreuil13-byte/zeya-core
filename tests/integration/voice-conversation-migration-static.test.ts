import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const migration = await readFile(path.join(root, "supabase/migrations/20260715090000_voice_conversation_output_capture.sql"), "utf8");
  const purge = await readFile(path.join(root, "supabase/migrations/20260715093000_voice_conversation_output_controlled_purge_patch.sql"), "utf8");
  const rollback = await readFile(path.join(root, "docs/database/rollbacks/voice_conversation_output_capture_rollback.sql"), "utf8");
  const migrations = await readdir(path.join(root, "supabase/migrations"));
  for (const expected of [
    "voice_conversation_outputs", "voice_conversation_candidates",
    "capture_source", "transcript_trust_level", "provider_attested", "submitted_by",
    "zeya_capture_voice_conversation_output", "zeya_finalize_voice_conversation_transcript",
    "zeya_set_voice_conversation_processing_status", "zeya_store_voice_conversation_candidates",
    "SET search_path = ''", "client-relayed transcript cannot create candidate Evidence",
    "REVOKE ALL ON FUNCTION public.zeya_enforce_voice_output_immutability()",
  ]) assert.ok(migration.includes(expected), `migration contains ${expected}`);

  assert.ok(!/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:evidence|observations|representation_proposals|approval_decisions|representation_versions|confidence_assessments|audit_events|representation_elements)\b/.test(migration), "migration has no Canonical Representation mutations");
  assert.ok(migration.includes("REVOKE ALL ON public.voice_conversation_outputs FROM PUBLIC, anon, authenticated, service_role"));
  assert.ok(migration.includes("REVOKE ALL ON public.voice_conversation_candidates FROM PUBLIC, anon, authenticated, service_role"));
  assert.ok(!migrations.some((name) => /voice_conversation_output.*rollback/i.test(name)), "no Phase 2 rollback is a forward migration");
  assert.deepEqual(migrations.filter((name) => /^20260715\d{6}_voice_conversation_output/.test(name)).sort(), [
    "20260715090000_voice_conversation_output_capture.sql",
    "20260715093000_voice_conversation_output_controlled_purge_patch.sql",
  ]);
  assert.ok(rollback.startsWith("BEGIN;"), "manual rollback begins atomically");
  assert.ok(rollback.includes("-- MANUAL EMERGENCY ROLLBACK ONLY."), "manual rollback is clearly labeled");

  for (const comparison of [
    "v_existing.conversation_id = p_conversation_id",
    "v_existing.provider_call_id IS NOT DISTINCT FROM v_effective_provider_call_id",
    "v_existing.provider = p_provider",
    "v_existing.channel = p_channel",
    "v_existing.capture_source = p_capture_source",
    "v_existing.transcript_trust_level = p_transcript_trust_level",
    "v_existing.provider_attested = p_provider_attested",
    "v_existing.submitted_by IS NOT DISTINCT FROM p_submitted_by",
    "v_existing.started_at IS NOT DISTINCT FROM p_started_at",
    "v_existing.completed_at IS NOT DISTINCT FROM p_completed_at",
    "v_existing.transcript = p_transcript",
    "v_existing.transcript_status = p_transcript_status",
    "v_existing.transcript_schema_version = p_transcript_schema_version",
    "v_existing.conversation_status = p_conversation_status",
    "v_existing.completion_reason IS NOT DISTINCT FROM p_completion_reason",
    "v_existing.extraction_schema_version = p_extraction_schema_version",
    "v_existing.safe_metadata = COALESCE(p_safe_metadata, '{}'::jsonb)",
  ]) assert.ok(migration.includes(comparison), `capture replay compares ${comparison}`);
  assert.ok(migration.includes("v_effective_provider_call_id := v_lineage.provider_call_id"), "provider call ID derives from stored lineage");
  assert.ok(migration.includes("v_effective_provider_call_id, p_channel"), "derived provider call ID is persisted");
  assert.ok(migration.includes("COALESCE(p_safe_metadata, '{}'::jsonb)"), "safe metadata is normalized for storage and equality");

  for (const comparison of [
    "v_effective_completed_at := COALESCE(p_completed_at, v_output.completed_at)",
    "v_output.transcript = p_transcript",
    "v_output.completed_at IS NOT DISTINCT FROM v_effective_completed_at",
    "v_output.conversation_status = p_conversation_status",
    "v_output.completion_reason IS NOT DISTINCT FROM p_completion_reason",
  ]) assert.ok(migration.includes(comparison), `finalization replay compares ${comparison}`);
  assert.ok(migration.includes("OLD.transcript_trust_level = 'status_only'"), "only status-only output may gain provider attestation");
  assert.ok(migration.includes("OLD.transcript = '[]'::jsonb"), "delayed finalization starts from an empty transcript");
  assert.ok(migration.includes("v_output.capture_source <> 'status_only'"), "delayed finalization rejects non-status-only capture sources");
  assert.ok(migration.includes("v_output.transcript_trust_level <> 'status_only'"), "delayed finalization rejects non-status-only trust");
  assert.ok(migration.includes("OR v_output.provider_attested"), "delayed finalization rejects already-attested non-finalized rows");

  for (const marker of [
    "completed_extraction_schema_version TEXT",
    "extraction_result_hash TEXT",
    "extracted_candidate_count INTEGER CHECK (extracted_candidate_count >= 0)",
    "CONSTRAINT voice_output_extraction_result_complete CHECK",
    "v_result_hash := md5(p_candidates::text)",
    "v_count := jsonb_array_length(p_candidates)",
    "v_output.completed_extraction_schema_version = p_extraction_schema_version",
    "v_output.extraction_result_hash = v_result_hash",
    "v_output.extracted_candidate_count = v_count",
    "completed_extraction_schema_version = p_extraction_schema_version",
    "extraction_result_hash = v_result_hash",
    "extracted_candidate_count = v_count",
  ]) assert.ok(migration.includes(marker), `durable extraction identity contains ${marker}`);
  assert.ok(migration.includes("p_extraction_schema_version <> v_output.extraction_schema_version"), "candidate storage rejects alternate extraction schema versions");
  assert.ok(migration.includes("SELECT * INTO v_lineage FROM public.voice_representation_lineage"), "candidate storage loads linked lineage");
  assert.ok(migration.includes("agent statement cannot create candidate Evidence"), "candidate storage rejects agent Evidence");
  assert.ok(migration.includes("client-relayed transcript cannot create candidate Evidence"), "candidate storage enforces Evidence trust");
  assert.ok(migration.includes("jsonb_array_elements_text(item->'relevantElementKeys')"), "candidate storage validates every relevant Element key");
  assert.ok(migration.includes("jsonb_typeof(element_key.value) IS DISTINCT FROM 'string'"), "candidate storage rejects non-string Element keys");
  assert.ok(migration.includes("btrim(element_key.value #>> '{}') = ''"), "candidate storage rejects blank Element keys");
  assert.ok(migration.includes("v_lineage.authorized_element_keys"), "candidate Element keys are restricted by stored lineage");
  for (const validation of [
    "jsonb_typeof(item->'content') IS DISTINCT FROM 'object'",
    "jsonb_typeof(item->'sourceReference') IS DISTINCT FROM 'object'",
    "jsonb_typeof(item->'relevantElementKeys') IS DISTINCT FROM 'array'",
    "jsonb_typeof(item->'confidence') = 'number'",
    "btrim(COALESCE(item->>'rationale', '')) = ''",
  ]) assert.ok(migration.includes(validation), `candidate RPC validates ${validation}`);
  for (const stateRule of [
    "NEW.transcript_status IS DISTINCT FROM OLD.transcript_status",
    "NEW.completed_at IS DISTINCT FROM OLD.completed_at",
    "NEW.conversation_status IS DISTINCT FROM OLD.conversation_status",
    "NEW.completion_reason IS DISTINCT FROM OLD.completion_reason",
    "extraction result identity is immutable",
    "invalid conversation processing transition",
  ]) assert.ok(migration.includes(stateRule), `output trigger enforces ${stateRule}`);

  assert.equal((rollback.match(/\bBEGIN;/g) ?? []).length, 1, "rollback has one transaction begin");
  assert.equal((rollback.match(/\bCOMMIT;/g) ?? []).length, 1, "rollback has one transaction commit");
  const rollbackBegin = rollback.indexOf("BEGIN;");
  const purgeRestore = rollback.indexOf("CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation");
  const phaseTwoDrop = rollback.indexOf("DROP FUNCTION IF EXISTS public.zeya_store_voice_conversation_candidates");
  const outputTableDrop = rollback.indexOf("DROP TABLE IF EXISTS public.voice_conversation_outputs");
  const identityIndexDrop = rollback.indexOf("DROP INDEX IF EXISTS public.voice_lineage_identity_idx");
  const schemaReload = rollback.indexOf("NOTIFY pgrst, 'reload schema'");
  const rollbackCommit = rollback.lastIndexOf("COMMIT;");
  assert.ok(rollbackBegin >= 0 && rollbackBegin < purgeRestore, "rollback transaction contains Phase 1 purge restoration");
  assert.ok(purgeRestore < phaseTwoDrop && phaseTwoDrop < outputTableDrop, "rollback restores purge before removing Phase 2 objects");
  assert.ok(outputTableDrop < identityIndexDrop, "rollback drops lineage identity index after output table");
  assert.ok(identityIndexDrop < schemaReload && schemaReload < rollbackCommit, "rollback reloads schema then commits after all removals");

  const candidateDelete = purge.indexOf("DELETE FROM public.voice_conversation_candidates");
  const outputDelete = purge.indexOf("DELETE FROM public.voice_conversation_outputs");
  const lineageDelete = purge.indexOf("DELETE FROM public.voice_representation_lineage");
  assert.ok(candidateDelete > 0 && candidateDelete < outputDelete && outputDelete < lineageDelete, "purge order is candidates, outputs, lineage");
  assert.ok(purge.includes("'voice_conversation_candidates'") && purge.includes("'voice_conversation_outputs'") && purge.includes("'voice_representation_lineage'"), "purge reports exact stable count keys");

  console.log("Voice Conversation Migration\n\nAdditive schema — PASS\nTrust model — PASS\nAuthorization SQL — PASS\nTrigger execution revoke — PASS\nInitial capture idempotency — PASS\nProvider-call consistency — PASS\nSafe-metadata normalization — PASS\nDelayed-finalization idempotency — PASS\nDelayed-finalization trust transition — PASS\nDurable candidate idempotency — PASS\nZero-candidate completion — PASS\nCandidate RPC validation — PASS\nAuthorized Element restriction — PASS\nTranscript state machine — PASS\nExtraction-result immutability — PASS\nProcessing state machine — PASS\nForward sequence — PASS\nAtomic manual rollback — PASS\nCanonical safety — PASS\nControlled purge order — PASS\nStable deletion counts — PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration static test failed");
  process.exitCode = 1;
});
