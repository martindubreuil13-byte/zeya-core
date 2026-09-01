import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { FIRST_WORKING_SESSION_PREPARATION_VERSION } from "../../lib/onboarding/first-working-session-brief";
import {
  isFirstWorkingSessionPreparationCurrentAndUsable,
  resolveOwnerFormationPrecedence,
} from "../../lib/onboarding/first-working-session-currentness";

describe("first working-session preparation currentness", () => {
  const current = FIRST_WORKING_SESSION_PREPARATION_VERSION;

  it.each([
    ["running current", { preparation_status: "running", preparation_contract_version: current }, false],
    ["expired running current", { preparation_status: "running", preparation_contract_version: current, preparation_lease_expires_at: "2000-01-01T00:00:00Z" }, false],
    ["failed current", { preparation_status: "failed", preparation_contract_version: current }, false],
    ["ready old", { preparation_status: "ready", preparation_contract_version: "first-working-session-preparation-v4" }, false],
    ["ready current", { preparation_status: "ready", preparation_contract_version: current }, true],
    ["no scheduled session", null, false],
  ])("classifies %s", (_name, state, expected) => {
    expect(isFirstWorkingSessionPreparationCurrentAndUsable(state)).toBe(expected);
  });

  it.each([
    ["A ready current", true, true, { preparation_status: "ready", preparation_contract_version: current }, "active_formation"],
    ["B running current", true, true, { preparation_status: "running", preparation_contract_version: current }, "direct_hire_employed"],
    ["C expired running current", true, true, { preparation_status: "running", preparation_contract_version: current, preparation_lease_expires_at: "2000-01-01T00:00:00Z" }, "direct_hire_employed"],
    ["D failed current", true, true, { preparation_status: "failed", preparation_contract_version: current }, "direct_hire_employed"],
    ["E ready old", true, true, { preparation_status: "ready", preparation_contract_version: "first-working-session-preparation-v4" }, "direct_hire_employed"],
    ["F no scheduled session", true, true, null, "direct_hire_employed"],
    ["historical Formation without Direct Hire", true, false, null, "active_formation"],
    ["G Direct Hire without Formation", false, true, null, "direct_hire_employed"],
    ["G neither journey", false, false, null, null],
  ])("resolves owner precedence for %s", (_name, hasActiveFormation, hasDirectHireOnboarding, authoritativeWorkingSession, expected) => {
    expect(resolveOwnerFormationPrecedence({
      hasActiveFormation,
      hasDirectHireOnboarding,
      authoritativeWorkingSession,
    })).toBe(expected);
  });

  it("is the single predicate used by both owner status and Direct Hire re-entry", async () => {
    const [ownerStatus, directHire] = await Promise.all([
      readFile("app/api/owner/status/route.ts", "utf8"),
      readFile("app/api/onboarding/direct-hire/route.ts", "utf8"),
    ]);

    expect(ownerStatus).toContain("resolveOwnerFormationPrecedence");
    expect(directHire).toContain("isFirstWorkingSessionPreparationCurrentAndUsable");
    expect(ownerStatus).toContain(".eq('status', 'scheduled')");
    expect(directHire).toContain('.eq("status", "scheduled")');
    expect(ownerStatus).not.toContain("FIRST_WORKING_SESSION_PREPARATION_VERSION");
    expect(directHire).not.toContain("FIRST_WORKING_SESSION_PREPARATION_VERSION");
  });
});
