import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260805000000_direct_hire_preparation_research.sql";
const foundationMigrationPath =
  "supabase/migrations/20260804000000_direct_hire_onboarding_vertical_slice.sql";

describe("Direct Hire preparation migration", () => {
  it("is additive, transactional, and contains only the approved preparation states", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql.match(/BEGIN;/g)?.length).toBe(2);
    expect(sql.match(/COMMIT;/g)?.length).toBe(2);
    expect(sql).toContain("'queued', 'running', 'ready', 'partial', 'failed'");
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });

  it("adds only required execution, provenance, and deduplication fields", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const value of [
      "research_authorized_at", "preparation_attempt_count", "preparation_lease_id",
      "preparation_lease_expires_at", "preparation_failure_code", "preparation_progress",
      "preparation_successful_page_count", "preparation_failed_page_count",
      "direct_hire_onboarding_session_id", "website_source_key", "requested_source_url",
      "canonical_source_url", "source_retrieved_at", "source_content_hash",
      "source_page_type", "source_evidence_kind", "extraction_method_version",
      "website_observation_key", "public_website",
    ]) expect(sql).toContain(value);
    expect(sql).toContain("evidence_website_source_key_unique");
    expect(sql).toContain("ON public.evidence (direct_hire_onboarding_session_id, website_source_key)");
    expect(sql).toContain("observations_website_key_unique");
    expect(sql).not.toMatch(/direct_hire_onboarding_session_id[\s\S]{0,120}ON DELETE CASCADE/);
  });

  it("enforces authentication, service authority, lineage, leases, and three attempts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql.match(/SET search_path = ''/g)?.length).toBe(5);
    expect(sql).toContain("auth.role() <> 'authenticated'");
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain("preparation_attempt_count >= 3");
    expect(sql).toContain("preparation_lease_id <> p_lease_id");
    expect(sql).toContain("direct_hire_profile_update_guard");
    expect(sql).toContain("BEFORE UPDATE OF owner_relationship_name, website_url, phone_e164");
    const updateTrigger = sql.match(
      /CREATE TRIGGER direct_hire_profile_update_guard[\s\S]*?EXECUTE FUNCTION[^;]+;/,
    )?.[0];
    expect(updateTrigger).not.toContain("preparation_status");
    expect(sql).toContain("representation.current_version_id IS NULL");
    expect(sql).toContain("representation_formation_sessions");
    expect(sql).toContain("TO authenticated");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("NEW.source_type = 'public_website' AND (");
    expect(sql).toContain("current_user <> 'postgres'");
    expect(sql).toContain("NEW.captured_by_actor IS DISTINCT FROM 'zeya_direct_hire_website_research'");
    expect(sql).toContain("NEW.direct_hire_onboarding_session_id IS NULL");
    expect(sql).toContain("NEW.website_observation_key IS NOT NULL AND current_user <> 'postgres'");
    expect(sql).toContain("direct_hire_website_evidence_authority");
    expect(sql).toContain("direct_hire_website_observation_authority");
  });

  it("keeps authorization, duplicate claims, stale-lease retry, and attempt control atomic", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const claim = sql.slice(
      sql.indexOf("CREATE FUNCTION public.zeya_claim_direct_hire_preparation"),
      sql.indexOf("CREATE FUNCTION public.zeya_finalize_direct_hire_preparation"),
    );
    expect(claim).toContain("FOR UPDATE");
    expect(claim).toContain("FROM auth.users AS owner_user");
    expect(claim).toContain("v_session_count > 1");
    expect(claim).toContain("research_authorized_at = coalesce(session.research_authorized_at, now())");
    expect(claim).toContain("preparation_lease_expires_at > now()");
    expect(claim).toContain("preparation_status, v_session.preparation_lease_id");
    expect(claim).toContain("false;");
    expect(claim).toContain("preparation_attempt_count >= 3");
    expect(claim).toContain("preparation_lease_expires_at = now() + interval '45 seconds'");
    expect(claim).toContain("preparation_attempt_count = session.preparation_attempt_count + 1");
  });

  it("fails the second transaction closed unless the enum transaction completed", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("enum_type.typname = 'evidence_source_type'");
    expect(sql).toContain("enum_value.enumlabel = 'public_website'");
    expect(sql).toContain("required evidence source public_website is unavailable");
    expect(sql).toContain("rerun this entire file");
  });

  it("retains the existing owner-only RLS boundary", async () => {
    const foundation = await readFile(foundationMigrationPath, "utf8");
    expect(foundation).toContain("ENABLE ROW LEVEL SECURITY");
    expect(foundation).toContain("CREATE POLICY direct_hire_owner_select");
    expect(foundation).toContain("USING (owner_id = auth.uid())");
    expect(foundation).toContain("GRANT SELECT ON TABLE public.direct_hire_onboarding_sessions TO authenticated");
  });

  it("creates Evidence, optional Observations, and audits without canonical side effects", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("INSERT INTO public.evidence");
    expect(sql).toContain("INSERT INTO public.observations");
    expect(sql).toContain("'evidence_created'");
    expect(sql).toContain("'observation_created'");
    expect(sql).not.toMatch(/INSERT INTO public\.representation_(?:formation_sessions|proposals|versions)/);
    expect(sql).not.toMatch(/INSERT INTO public\.(?:approval_decisions|confidence_assessments)/);
    expect(sql).not.toContain("zeya_create_canonical_version_atomic");
    expect(sql).not.toContain("zeya_initiate_formation_session");
    expect(sql).not.toContain("current_version_id =");
  });

  it("preserves a truthful partial result when a retry fails after durable Evidence", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("p_final_status = 'failed' AND v_evidence_count > 0");
    expect(sql).toContain("p_final_status := 'partial'");
    expect(sql).toContain("p_failure_code := NULL");
  });
});
