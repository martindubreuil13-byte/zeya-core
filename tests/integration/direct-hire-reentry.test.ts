import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Direct Hire Re-entry and Durable Routing", () => {
  it("owner status detects active Direct Hire onboarding before defaulting to new_owner", async () => {
    const route = await readFile(
      "app/api/owner/status/route.ts",
      "utf8",
    );
    // Queries establish canonical state, then Formation + Direct Hire currentness
    // resolves precedence before the new-owner fallback.
    const versionCheck = route.indexOf("if (representation.current_version_id)");
    const formationCheck = route.indexOf(".from('representation_formation_sessions')");
    const directHireStart = route.indexOf("// Check for active Direct Hire onboarding");
    const fallbackStart = route.lastIndexOf("return newOwnerResponse()");

    expect(versionCheck).toBeLessThan(formationCheck);
    expect(formationCheck).toBeLessThan(directHireStart);
    expect(directHireStart).toBeLessThan(fallbackStart);

    // Verify direct_hire_onboarding_sessions lookup
    expect(route).toContain("direct_hire_onboarding_sessions");
    expect(route).toContain(".eq('business_representation_id'");
  });

  it("owner status returns direct_hire_employed with session and state info", async () => {
    const route = await readFile(
      "app/api/owner/status/route.ts",
      "utf8",
    );
    expect(route).toContain("status: 'direct_hire_employed'");
    expect(route).toContain("directHireSessionId");
    expect(route).toContain("onboardingState");
  });

  it("owner journey resolver routes accepted employment to induction/scheduling", async () => {
    const route = await readFile(
      "lib/owner/owner-route.ts",
      "utf8",
    );
    expect(route).toContain("DIRECT_HIRE_PREPARATION_PATH");
    expect(route).toContain('"direct_hire_employed"');
    expect(route).toContain("/onboarding/preparation");
    expect(route).toContain('state.onboardingState === "employment_accepted"');
  });

  it("formation entry page handles direct_hire_employed status", async () => {
    const page = await readFile(
      "app/formation/entry/page.tsx",
      "utf8",
    );
    expect(page).toContain("direct_hire_employed");
    expect(page).toContain("onboardingState");
    expect(page).toContain("resolveOwnerJourneyPath");
  });

  it("preparation page renders DirectHireInduction component", async () => {
    const page = await readFile(
      "app/onboarding/preparation/page.tsx",
      "utf8",
    );
    expect(page).toContain("DirectHireInduction");
    expect(page).toContain("inductionState !== 'preparation_pending'");
    expect(page).toContain("onReadyForScheduling");
    expect(page).not.toContain("/representation/living");
  });

  it("routes induction completion directly to scheduling without loading Summary", async () => {
    const page = await readFile(
      "app/onboarding/preparation/page.tsx",
      "utf8",
    );
    const inductionRequest = page.indexOf("authenticatedFetch(\n          '/api/onboarding/direct-hire/induction'");
    const inductionBoundary = page.indexOf("inductionState !== 'preparation_pending'");
    const scheduler = page.indexOf("<DirectHireWorkingSessionScheduler />");
    expect(inductionRequest).toBeGreaterThan(-1);
    expect(inductionRequest).toBeLessThan(inductionBoundary);
    expect(inductionBoundary).toBeLessThan(scheduler);
    expect(page).not.toContain("Promise.all([");
    expect(page).not.toContain("preparation/summary");
  });

  it("DirectHireInduction component loads correct surface on re-entry", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireInduction.tsx",
      "utf8",
    );
    // Component loads induction state and renders surface based on state
    expect(component).toContain('surface === "employment_accepted"');
    expect(component).toContain("/api/onboarding/direct-hire/induction");
    expect(component).toContain("setSurface");
  });

  it("employment acceptance surface links to the existing re-entry route", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    expect(component).toContain('router.push("/onboarding/preparation")');
    expect(component).toContain("Continue to induction");
  });

  it("routes only pre-acceptance profile owners back to the hiring decision", async () => {
    const resolver = await readFile(
      "lib/owner/owner-route.ts",
      "utf8",
    );
    // Accepted owners get induction/scheduling; profile-only owners resume acceptance.
    expect(resolver).toContain("direct_hire_employed");
    expect(resolver).toContain("DIRECT_HIRE_PREPARATION_PATH");
    expect(resolver).toContain("DIRECT_HIRE_ONBOARDING_PATH");

    // Verify new_owner still gets /onboarding
    const newOwnerRoute = resolver.slice(
      resolver.indexOf('status === "new_owner"'),
      resolver.indexOf('status === "has_representation"'),
    );
    expect(newOwnerRoute).toContain("DIRECT_HIRE_ONBOARDING_PATH");
  });

  it("does not collapse Direct Hire employment into /representation/living", async () => {
    const page = await readFile(
      "app/onboarding/preparation/page.tsx",
      "utf8",
    );
    const resolver = await readFile(
      "lib/owner/owner-route.ts",
      "utf8",
    );

    expect(page).not.toContain("/representation/living");
    const employed = resolver.slice(
      resolver.indexOf('status: "direct_hire_employed"'),
      resolver.indexOf('status: "has_representation"'),
    );
    expect(employed).not.toContain("LIVING_REPRESENTATION_PATH");
  });

  it("preserves Formation approval routing to /representation/living", async () => {
    const resolver = await readFile(
      "lib/owner/owner-route.ts",
      "utf8",
    );
    expect(resolver).toContain('status: "has_representation"');
    expect(resolver).toContain("LIVING_REPRESENTATION_PATH");
  });

  it("state-to-route mapping is complete and unambiguous", async () => {
    const resolver = await readFile(
      "lib/owner/owner-route.ts",
      "utf8",
    );
    // Every OwnerJourneyState status should have a route
    expect(resolver).toContain('status: "new_owner"');
    expect(resolver).toContain('status: "active_formation"');
    expect(resolver).toContain('status: "has_representation"');
    expect(resolver).toContain('status: "direct_hire_employed"');

    // Return null only for invalid UUIDs, not for valid statuses
    expect(resolver).toContain("return null;");
    expect(resolver).not.toMatch(/return null;\s*\}\s*if \(state\.status/);
  });

  it("does not treat employed owners as new owners after refresh", async () => {
    const statusRoute = await readFile(
      "app/api/owner/status/route.ts",
      "utf8",
    );
    // Verify that direct hire check comes before fallback to new_owner
    expect(statusRoute).toContain("directHireResult");
    expect(statusRoute).toContain("Check for active Direct Hire onboarding");

    const directHirePos = statusRoute.indexOf("Check for active Direct Hire onboarding");
    const fallbackPos = statusRoute.lastIndexOf("return newOwnerResponse");
    expect(directHirePos).toBeLessThan(fallbackPos);
  });
});
