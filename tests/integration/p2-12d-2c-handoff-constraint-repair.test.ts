import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const repair = readFileSync(
  "supabase/migrations/20260902000000_p2_12d_2c_remove_legacy_v4_handoff_constraint.sql",
  "utf8",
);
const synthesisMigration = readFileSync(
  "supabase/migrations/20260901010000_p2_12d_2_cross_source_observations.sql",
  "utf8",
);

const supported = [
  "first-working-session-preparation-v4",
  "first-working-session-preparation-v5",
  "first-working-session-preparation-v6",
];

describe("P2.12D.2c legacy handoff constraint repair", () => {
  it("drops only the exact obsolete v4-only constraint in an additive transaction", () => {
    expect(repair).toContain("BEGIN;");
    expect(repair).toContain("COMMIT;");
    expect(repair).toContain("DROP CONSTRAINT IF EXISTS direct_hire_first_working_se_preparation_contract_version_check");
    expect(repair).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(repair).not.toContain("direct_hire_first_working_session_formation_handoffs_preparatio;");
  });

  it.each(supported)("retained effective constraint accepts %s", version => {
    expect(synthesisMigration).toContain(`'${version}'`);
    expect(supported.includes(version)).toBe(true);
  });

  it("retained effective constraint rejects unsupported contract versions", () => {
    for (const version of ["first-working-session-preparation-v3", "first-working-session-preparation-v7", "random-version"]) {
      expect(supported.includes(version)).toBe(false);
      expect(synthesisMigration).not.toContain(`'${version}'`);
    }
  });

  it("keeps the historical v4 contract valid without rewriting historical handoffs", () => {
    expect(supported).toContain("first-working-session-preparation-v4");
    expect(repair).not.toMatch(/direct_hire_first_working_session_formation_handoffs\s+(?:SET|WHERE|VALUES)/i);
  });
});
