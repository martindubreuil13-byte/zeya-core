import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260804000000_direct_hire_onboarding_vertical_slice.sql";

describe("Direct Hire persistence migration", () => {
  it("creates one narrow owner/Business/Representation-linked record", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE public.direct_hire_onboarding_sessions");
    for (const column of [
      "owner_id",
      "business_id",
      "business_representation_id",
      "owner_relationship_name",
      "website_url",
      "phone_e164",
      "growth_priority",
      "onboarding_state",
      "preparation_status",
      "profile_completed_at",
      "created_at",
      "updated_at",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("UNIQUE (business_representation_id)");
    expect(sql).not.toContain("idempotency_key");
    expect(sql).not.toContain("preparation_completed_at");
    expect(sql).not.toContain("retry_requested_at");
  });

  it("enforces tenant lineage and owner-only reads", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("zeya_direct_hire_onboarding_validate_lineage");
    expect(sql).toContain("business.user_id = NEW.owner_id");
    expect(sql).toContain("representation.business_id = NEW.business_id");
    expect(sql).toContain("representation.user_id = NEW.owner_id");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("USING (owner_id = auth.uid())");
    expect(sql).toContain("REVOKE ALL ON TABLE public.direct_hire_onboarding_sessions");
    expect(sql).toContain("GRANT SELECT ON TABLE public.direct_hire_onboarding_sessions TO authenticated");
  });

  it("derives owner lineage in one authenticated, serialized RPC", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const rpc = sql.slice(sql.indexOf("CREATE FUNCTION public.zeya_upsert_direct_hire_profile"));
    expect(rpc).toContain("v_owner_id uuid := auth.uid()");
    expect(rpc).toContain("auth.role() <> 'authenticated'");
    expect(rpc).toContain("FROM auth.users WHERE id = v_owner_id FOR UPDATE");
    expect(rpc).toContain("ON CONFLICT (business_representation_id) DO UPDATE");
    expect(rpc).not.toMatch(/p_owner_id|p_business_id|p_business_representation_id/);
    expect(rpc).toContain("TO authenticated");
  });

  it("stops before research, Formation, and canonical persistence", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/INSERT INTO public\.public_experience_sessions/i);
    expect(sql).not.toMatch(/INSERT INTO public\.evidence/i);
    expect(sql).not.toMatch(/INSERT INTO public\.observations/i);
    expect(sql).not.toMatch(/INSERT INTO public\.representation_formation_sessions/i);
    expect(sql).not.toMatch(/INSERT INTO public\.representation_proposals/i);
    expect(sql).not.toMatch(/INSERT INTO public\.representation_versions/i);
    expect(sql).not.toContain("zeya_initiate_formation_session");
    expect(sql).not.toContain("zeya_create_canonical_version_atomic");
  });
});
