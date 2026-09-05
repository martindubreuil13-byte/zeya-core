import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260905020000_one_time_martin_qa_app_data_reset.sql",
  ),
  "utf8",
);

describe("one-time Martin QA app-data reset migration", () => {
  it("is pinned to Martin's current QA identity and has no tenant parameters", () => {
    expect(migration).toContain("zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()");
    expect(migration).toContain("332d2299-0657-4d90-b43b-bda03bff6175");
    expect(migration).toContain("049d1a9c-c0dc-4113-ab31-44633e5a4141");
    expect(migration).toContain("886b773d-5c26-42e1-8089-17ae3c28fa96");
    expect(migration).toContain("martin@mindrasolutions.com");
    expect(migration).not.toContain("mdubreu@gmail.com");
    expect(migration).not.toMatch(/zeya_one_time_reset_martin_direct_hire_v6_qa_20260905\([^)]/);
  });

  it("preserves Auth and requires service_role execution", () => {
    expect(migration).toContain("FROM auth.users AS owner");
    expect(migration).toContain("v_email IS DISTINCT FROM v_expected_email");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+auth\.users\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+auth\.users\b/i);
    expect(migration).toContain("IF auth.role() <> 'service_role'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()");
    expect(migration).toContain("TO service_role");
  });

  it("uses a reset-local immutability bypass without changing Formation uniqueness", () => {
    expect(migration).toContain("current_setting('zeya.qa_app_data_reset', true) = 'on'");
    expect(migration).toContain("current_user = 'postgres'");
    expect(migration).toContain("PERFORM pg_catalog.set_config('zeya.qa_app_data_reset', 'on', true)");
    expect(migration).not.toMatch(/DROP\s+CONSTRAINT\s+.*formation_session_representation_uniq/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+public\.representation_formation_sessions[\s\S]*DROP\s+CONSTRAINT/i);
  });

  it("deletes the stale Direct Hire graph before business and representation roots", () => {
    const order = [
      "DELETE FROM public.direct_hire_formation_authority_disposition_corrections",
      "DELETE FROM public.direct_hire_formation_answer_classification_corrections",
      "DELETE FROM public.direct_hire_formation_decision_supersessions",
      "DELETE FROM public.direct_hire_formation_agenda_resolution_events",
      "DELETE FROM public.direct_hire_formation_decisions",
      "DELETE FROM public.direct_hire_formation_conversation_turns",
      "DELETE FROM public.direct_hire_formation_conversation_runs",
      "DELETE FROM public.direct_hire_formation_prepared_context",
      "DELETE FROM public.direct_hire_first_working_session_v6_one_attempt_recoveries",
      "DELETE FROM public.direct_hire_first_working_session_preparation_regenerations",
      "DELETE FROM public.direct_hire_first_working_session_preparation_recoveries",
      "DELETE FROM public.direct_hire_first_working_session_formation_agenda_items",
      "DELETE FROM public.direct_hire_first_working_session_formation_handoffs",
      "DELETE FROM public.representation_formation_sessions",
      "DELETE FROM public.direct_hire_first_working_session_briefs",
      "DELETE FROM public.hypothesis_owner_operations",
      "DELETE FROM public.hypothesis_verifications",
      "DELETE FROM public.hypotheses",
      "DELETE FROM public.direct_hire_public_sources",
      "DELETE FROM public.observations",
      "DELETE FROM public.evidence",
      "DELETE FROM public.audit_events",
      "DELETE FROM public.direct_hire_working_sessions",
      "DELETE FROM public.direct_hire_onboarding_sessions",
      "DELETE FROM public.business_representations",
      "DELETE FROM public.businesses",
    ];

    let previous = -1;
    for (const token of order) {
      const current = migration.indexOf(token);
      expect(current, token).toBeGreaterThan(previous);
      previous = current;
    }
  });
});
