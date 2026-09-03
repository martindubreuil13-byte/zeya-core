import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260903000000_p2_12d_2h_v6_one_attempt_recovery.sql",
), "utf8");

describe("P2.12D.2h audited v6 one-attempt recovery", () => {
  it("targets only the exact exhausted failed v6 validation state", () => {
    for (const predicate of [
      "v_session.preparation_status <> 'failed'",
      "v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v6'",
      "v_session.preparation_failure_code IS DISTINCT FROM 'preparation_reasoning_output_validation_failed'",
      "v_session.preparation_attempt_count <> 10",
    ]) expect(migration).toContain(predicate);
  });

  it("authorizes only the 10 to 9 transition", () => {
    expect(migration).toContain("SET preparation_attempt_count = 9");
    expect(migration).toContain("AND working_session.preparation_attempt_count = 10");
    expect(migration).not.toContain("preparation_attempt_count = 0");
  });

  it("rejects a second recovery", () => {
    expect(migration).toContain("v6 one-attempt recovery already granted");
    expect(migration).toContain("direct_hire_working_session_id uuid NOT NULL UNIQUE");
  });

  it("rejects wrong failure and contract values through fixed predicates", () => {
    expect(migration.match(/first-working-session-preparation-v6/g)?.length).toBeGreaterThan(5);
    expect(migration.match(/preparation_reasoning_output_validation_failed/g)?.length).toBeGreaterThan(4);
  });

  it("rejects active leases", () => {
    expect(migration).toContain("v_session.preparation_lease_id IS NOT NULL");
    expect(migration).toContain("v_session.preparation_lease_expires_at IS NOT NULL");
  });

  it("rejects a current brief", () => {
    expect(migration).toContain("brief.direct_hire_working_session_id = v_session.id AND brief.current");
  });

  it("requires exhausted state", () => {
    expect(migration).toContain("prior_attempt_count smallint NOT NULL CHECK (prior_attempt_count = 10)");
    expect(migration).toContain("v_session.preparation_attempt_count <> 10");
  });

  it("binds the exact tenant and session identity", () => {
    for (const [field, parameter] of [
      ["direct_hire_onboarding_session_id", "onboarding_session_id"],
      ["owner_id", "owner_id"],
      ["business_id", "business_id"],
      ["business_representation_id", "business_representation_id"],
    ]) expect(migration).toContain(`v_session.${field} <> p_${parameter}`);
  });

  it("writes exactly one immutable, non-sensitive audit record", () => {
    expect(migration).toContain("INSERT INTO public.direct_hire_first_working_session_v6_one_attempt_recoveries");
    expect(migration).toContain("FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_first_working_session_preparation_recovery_modification()");
    expect(migration).toContain("recovery_reason = 'p2.12d.2h governed verification'");
    expect(migration).toContain("correlation_id uuid NOT NULL UNIQUE");
  });

  it("changes no preparation fields during recovery except attempt count", () => {
    const recoveryUpdate = migration.slice(
      migration.indexOf("UPDATE public.direct_hire_working_sessions AS working_session\n  SET preparation_attempt_count = 9"),
      migration.indexOf("GET DIAGNOSTICS v_rows_updated"),
    );
    const setClause = recoveryUpdate.slice(
      recoveryUpdate.indexOf("SET"),
      recoveryUpdate.indexOf("WHERE"),
    );
    expect(setClause.trim()).toBe("SET preparation_attempt_count = 9");
  });

  it("uses the normal claim path and consumes recovery at claim time", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.zeya_claim_first_working_session_preparation");
    expect(migration).toContain("v_claim_attempt_count := CASE WHEN v_consumes_v6_recovery THEN 10");
    expect(migration).toContain("preparation_attempt_count = v_claim_attempt_count");
  });

  it("leaves no further budget immediately after the recovered claim", () => {
    expect(migration).toContain("candidate.preparation_attempt_count < 10");
    expect(migration).toContain("v_claim_attempt_count := CASE WHEN v_consumes_v6_recovery THEN 10");
  });

  it("is service-role-only", () => {
    expect(migration).toContain("IF auth.role() <> 'service_role'");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });
});
