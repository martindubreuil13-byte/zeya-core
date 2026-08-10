import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Direct Hire Employment Accepted", () => {
  it("accepts employment only after preparation completes", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    expect(route).toContain('onboarding.preparation_status !== "ready" && onboarding.preparation_status !== "partial"');
    expect(route).toContain("preparation_not_complete");
    expect(route).not.toContain("preparation_status === 'failed'");
  });

  it("does NOT create a representation version on employment acceptance", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    expect(route).not.toContain('from("representation_versions")');
    expect(route).not.toContain(".insert({");
    expect(route).not.toContain("element_values");
    expect(route).not.toContain("source_type");
  });

  it("does NOT set current_version_id on employment acceptance", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    const updateSection = route.slice(route.indexOf("sessionUpdate"), route.indexOf("return success"));
    expect(updateSection).not.toContain("current_version_id");
    expect(route).not.toContain(".update({ current_version_id");
  });

  it("only updates onboarding session to employment_accepted state", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    const migration = await readFile(
      "supabase/migrations/20260809000001_direct_hire_accept_employment_rpc.sql",
      "utf8",
    );
    expect(route).toContain('"zeya_accept_direct_hire_employment"');
    expect(migration).toContain("SET onboarding_state = 'employment_accepted'");
    expect(route).toContain("Employment acceptance does NOT create a canonical Representation Version");
  });

  it("shows employment_accepted as a governed transition into induction", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    expect(component).toContain('surface === "employment_accepted"');
    expect(component).toContain("Thank you for trusting me with this role");
    expect(component).not.toContain("Your business representation has been created");
    expect(component).toContain("Before I can represent your business credibly, I need time and material to prepare");
    expect(component).toContain("Representation is governed, not generated");
    expect(component).toContain('router.push("/onboarding/preparation")');
    expect(component).toContain("Continue to induction");
    expect(component).not.toContain("In a future update");
  });

  it("does NOT route to /representation/living after employment acceptance", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    const employmentSection = component.slice(
      component.indexOf('surface === "employment_accepted"'),
      component.indexOf('surface === "error"'),
    );
    expect(employmentSection).not.toContain('router.push("/representation/living")');
    expect(employmentSection).not.toContain("Continue to your representation");
  });

  it("does not leave an already-employed owner at a dead end", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    const employmentSection = component.slice(
      component.indexOf('surface === "employment_accepted"'),
      component.indexOf('surface === "error"'),
    );
    expect(employmentSection).toContain("Continue to induction");
    expect(employmentSection).toContain('/onboarding/preparation');
  });

  it("profile data remains as preparation evidence, not canonical truth", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    expect(route).toContain("does NOT create");
    expect(route).toContain("zeya_accept_direct_hire_employment");
    expect(route).not.toContain("element_values");
    expect(route).not.toContain("overall_confidence_score");
  });

  it("does not accept employment without complete preparation", async () => {
    const route = await readFile(
      "app/api/onboarding/direct-hire/accept-employment/route.ts",
      "utf8",
    );
    expect(route).not.toContain("preparation_status === 'queued'");
    expect(route).not.toContain("preparation_status === 'running'");
    expect(route).not.toContain("preparation_status === 'not_started'");
  });

  it("preserves governance principle that study material is evidence, not approved truth", async () => {
    const inductionRoute = await readFile(
      "app/api/onboarding/direct-hire/induction/route.ts",
      "utf8",
    );
    expect(inductionRoute).toContain('.from("evidence")');
    expect(inductionRoute).toContain('source_type: "direct_hire_induction"');
    expect(inductionRoute).not.toContain('from("representation_versions")');
    expect(inductionRoute).not.toContain('from("approval_decisions")');
  });
});
