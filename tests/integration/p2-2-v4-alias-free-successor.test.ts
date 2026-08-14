import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260814010000_direct_hire_first_working_session_v4_alias_free_successor.sql";
const preflight = "supabase/manual/20260814_direct_hire_first_working_session_v4_upgrade_preflight.sql";
const postcheck = "supabase/manual/20260814_direct_hire_first_working_session_v4_upgrade_postcheck.sql";

describe("P2.2 governed v3 to v4 alias-free successor", () => {
  it("uses one exact, serialized, idempotent transition", async () => {
    const sql = await readFile(migration, "utf8");
    for (const marker of [
      "p_working_session_id uuid",
      "p_expected_current_v3_brief_id uuid",
      "p_regeneration_reason_code text",
      "working_session.id = p_working_session_id",
      "FOR UPDATE",
      "IF EXISTS",
      "persisted_alias_invariant_upgrade",
      "v_session.status <> 'scheduled'",
      "v_session.preparation_status <> 'ready'",
      "v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v3'",
      "v_current_brief.id IS DISTINCT FROM p_expected_current_v3_brief_id",
      "v_current_brief.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v3'",
      "v_session.preparation_lease_id IS NOT NULL",
      "v_session.preparation_lease_expires_at IS NOT NULL",
      "onboarding.onboarding_state = 'employment_accepted'",
      "onboarding.induction_state = 'preparation_pending'",
      "representation.current_version_id IS NULL",
      "formation.business_representation_id = v_session.business_representation_id",
    ]) expect(sql).toContain(marker);
  });

  it("records immutable history before granting the new contract budget", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("direct_hire_first_working_session_preparation_regenerations");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("preparation regeneration records are immutable");
    for (const column of [
      "direct_hire_working_session_id", "owner_id", "business_id",
      "business_representation_id", "direct_hire_onboarding_session_id",
      "prior_contract_version", "new_contract_version", "prior_preparation_status",
      "prior_attempt_count", "prior_snapshot_fingerprint", "prior_current_brief_id",
      "website_checkpoint_at", "regeneration_reason_code", "regenerated_by_role", "regenerated_at",
    ]) expect(sql).toContain(column);
    expect(sql.indexOf("INSERT INTO public.direct_hire_first_working_session_preparation_regenerations")).toBeLessThan(
      sql.indexOf("UPDATE public.direct_hire_working_sessions AS working_session"),
    );
  });

  it("preserves v3 and intelligence while resetting only v4 execution state", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("preparation_status = 'pending'");
    expect(sql).toContain("preparation_attempt_count = 0");
    expect(sql).toContain("preparation_contract_version = 'first-working-session-preparation-v4'");
    expect(sql).not.toMatch(/preparation_website_persisted_at\s*=/i);
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.(?:evidence|observations|hypotheses|direct_hire_first_working_session_briefs|representation_formation_sessions|representation_versions)/i);
    expect(sql).not.toContain("current_version_id =");
  });

  it("adds a v4-only, fail-closed statement alias guard without rewriting JSON", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("NEW.preparation_contract_version <> 'first-working-session-preparation-v4'");
    expect(sql).toContain("jsonb_path_query(NEW.brief, 'strict $.**.statement')");
    expect(sql).toContain("jsonb_typeof(v_statement) <> 'string'");
    expect(sql).toContain("[EH][1-9][0-9]*");
    expect(sql).toContain("v4 preparation brief statement contains a provider citation alias");
    expect(sql).not.toMatch(/NEW\.brief\s*:=|jsonb_set\s*\(/i);
  });

  it("keeps the transition service-role only and the ledger private", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("v_jwt_role IS DISTINCT FROM 'service_role'");
    expect(sql).toContain("v_database_role NOT IN ('postgres', 'service_role')");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("GRANT SELECT ON TABLE public.direct_hire_first_working_session_preparation_regenerations\n  TO service_role");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text)\n  TO service_role");
  });

  it("relies on the unchanged claim checkpoint and finalizer current switch", async () => {
    const predecessor = await readFile("supabase/migrations/20260813010000_direct_hire_first_working_session_preparation.sql", "utf8");
    const claim = predecessor.slice(predecessor.indexOf("CREATE FUNCTION public.zeya_claim_first_working_session_preparation"), predecessor.indexOf("CREATE FUNCTION public.zeya_persist_first_working_session_website_research"));
    const finalize = predecessor.slice(predecessor.indexOf("CREATE FUNCTION public.zeya_finalize_first_working_session_preparation"), predecessor.indexOf("CREATE FUNCTION public.zeya_fail_first_working_session_preparation"));
    expect(claim).toContain("v_session.preparation_website_persisted_at IS NOT NULL");
    expect(claim).toContain("THEN NULL ELSE v_session.preparation_website_persisted_at END");
    expect(finalize.indexOf("SET current=false")).toBeLessThan(finalize.indexOf("INSERT INTO public.direct_hire_first_working_session_briefs"));
    expect(finalize).toContain("preparation_contract_version=p_contract_version");
  });

  it("reuses the checkpoint and current hypotheses in orchestration", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    const intelligence = await readFile("lib/onboarding/preparation-intelligence.ts", "utf8").catch(() => "");
    expect(worker).toContain("if (!claim.website_persisted)");
    expect(worker).toContain("ensurePreparationIntelligence(client, scope)");
    expect(worker).not.toContain("first-working-session-preparation-v3");
    expect(intelligence).toContain("loadFreshCurrentPreparationHypotheses(client, scope)");
    expect(intelligence).toContain("hasCurrentReasoningSnapshot(current, snapshot.reasoningRunId)");
    expect(intelligence).toContain("if (existing.length === PREPARATION_DOMAINS.length) return existing");
  });

  it("ships exact-target read-only preflight and two-checkpoint postcheck", async () => {
    const files = await Promise.all([readFile(preflight, "utf8"), readFile(postcheck, "utf8")]);
    for (const sql of files) {
      expect(sql).toContain("715f4971-4d3f-4f53-9b89-a9dd703349d8");
      expect(sql).toContain("48c5fb80-523b-4d7c-9a66-d103c37ead75");
      expect(sql).toContain("PASS");
      expect(sql).not.toMatch(/^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+(?:TABLE|FUNCTION)|CREATE\s+(?:TABLE|FUNCTION)|DROP\s+(?:TABLE|FUNCTION)|TRUNCATE)\b/im);
    }
    expect(files[0]).toContain("v4_upgrade_objects_absent");
    expect(files[0]).toContain("evidence_rows");
    expect(files[1]).toContain("A_transition_pending_v4_checkpoint_preserved");
    expect(files[1]).toContain("B_ready_v4_snapshot_and_governance");
    expect(files[1]).toContain("B_one_current_v4_with_v3_and_v1_history");
  });
});
