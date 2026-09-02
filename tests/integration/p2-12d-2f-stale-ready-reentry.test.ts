import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPreparationRequestGuard,
  shouldAllowExplicitPreparationRetry,
  shouldAutoTriggerPreparation,
} from "../../lib/onboarding/preparation-retry-policy";
import { canStartDirectHireWorkingSession, type DirectHireWorkingSession } from "../../lib/onboarding/direct-hire-working-session";
import { isFirstWorkingSessionPreparationCurrentAndUsable } from "../../lib/onboarding/first-working-session-currentness";

const session = (overrides: Partial<DirectHireWorkingSession> = {}): DirectHireWorkingSession => ({
  id: "1453a5ac-8c2c-4dde-8993-bc49d74a301a",
  onboardingSessionId: "ba4bb9d8-9e81-4d3d-acef-46406062c3b9",
  formationSessionId: "ddc84722-266e-44ea-a6c2-5458a8b346bf",
  sessionKind: "first_working_session",
  scheduledAt: "2026-08-29T08:45:00.000Z",
  schedulingTimezone: "Asia/Bangkok",
  status: "scheduled",
  preparationStatus: "ready",
  preparationContractVersion: "first-working-session-preparation-v6",
  preparationCurrent: true,
  preparationFailureCode: null,
  preparationAttemptCount: 9,
  ...overrides,
});

describe("P2.12D.2f stale-ready preparation re-entry", () => {
  it("does not trigger ready/current preparation and makes Start available", () => {
    expect(shouldAutoTriggerPreparation("ready", null, 9, 10, true)).toBe(false);
    expect(canStartDirectHireWorkingSession(session())).toBe(true);
  });

  it("triggers ready/stale exactly once and keeps Start unavailable", () => {
    expect(shouldAutoTriggerPreparation("ready", null, 9, 10, false)).toBe(true);
    expect(canStartDirectHireWorkingSession(session({ preparationCurrent: false, preparationContractVersion: "first-working-session-preparation-v5" }))).toBe(false);
    const guard = createPreparationRequestGuard();
    expect(guard.tryStart(session().id)).toBe(true);
    expect(guard.tryStart(session().id)).toBe(false);
    guard.finish(session().id);
    expect(guard.tryStart(session().id)).toBe(false);
  });

  it("does not trigger stale-ready at the attempt cap", () => {
    expect(shouldAutoTriggerPreparation("ready", null, 10, 10, false)).toBe(false);
    expect(canStartDirectHireWorkingSession(session({ preparationCurrent: false, preparationAttemptCount: 10 }))).toBe(false);
  });

  it("preserves pending/running automation and failed-state explicit retry semantics", () => {
    expect(shouldAutoTriggerPreparation("pending", null, 0)).toBe(true);
    expect(shouldAutoTriggerPreparation("running", null, 1)).toBe(true);
    expect(shouldAutoTriggerPreparation("failed", "request_failed", 1)).toBe(false);
    expect(shouldAllowExplicitPreparationRetry("failed", "request_failed", 1)).toBe(true);
    expect(shouldAllowExplicitPreparationRetry("failed", "brief_input_snapshot_invalid", 1)).toBe(false);
  });

  it("allows an explicit retry after a completed automatic request without enabling replay", () => {
    const guard = createPreparationRequestGuard();
    expect(guard.tryStart(session().id)).toBe(true);
    guard.finish(session().id);
    expect(guard.tryStart(session().id)).toBe(false);
    expect(guard.tryStart(session().id, true)).toBe(true);
  });

  it("keeps canonical currentness and owner-routing precedence contract-aware", () => {
    expect(isFirstWorkingSessionPreparationCurrentAndUsable({ preparation_status: "ready", preparation_contract_version: "first-working-session-preparation-v6" })).toBe(true);
    expect(isFirstWorkingSessionPreparationCurrentAndUsable({ preparation_status: "ready", preparation_contract_version: "first-working-session-preparation-v5" })).toBe(false);
  });

  it("projects currentness server-side and re-fetches authoritative state after the exact authenticated request", () => {
    const api = readFileSync("app/api/onboarding/direct-hire/working-session/route.ts", "utf8");
    const component = readFileSync("components/onboarding/DirectHireWorkingSession.tsx", "utf8");
    expect(api).toContain("preparation_contract_version");
    expect(api).toContain("isFirstWorkingSessionPreparationCurrentAndUsable(row)");
    expect(component).toContain("/api/onboarding/direct-hire/working-session/${workingSession.id}/prepare");
    expect(component).toContain('authenticatedFetch(\n        "/api/onboarding/direct-hire/working-session"');
    expect(component.indexOf("refreshedResponse")).toBeGreaterThan(component.indexOf("method: \"POST\""));
    expect(component).not.toMatch(/preparationCurrent:\s*true/);
  });

  it("does not automatically mutate Formation or historical briefs", () => {
    const component = readFileSync("components/onboarding/DirectHireWorkingSession.tsx", "utf8");
    const loadBlock = component.slice(component.indexOf("const load ="), component.indexOf("const formattedSchedule"));
    expect(loadBlock).not.toContain("/api/onboarding/direct-hire/formation");
    expect(component).not.toContain("direct_hire_first_working_session_briefs");
    expect(component).not.toContain("preparation_contract_version");
  });
});
