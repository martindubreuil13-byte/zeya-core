import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const execute = vi.fn();
const getTelemetry = vi.fn();
const createService = vi.fn(() => ({}));
const from = vi.fn();

vi.mock("@/lib/representation/api-auth", () => ({
  createAuthenticatedRepresentationContext: vi.fn(async () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    supabase: { from },
  })),
}));
vi.mock("@/lib/onboarding/direct-hire-service-client", () => ({ createDirectHireServiceClient: createService }));
vi.mock("@/lib/onboarding/first-working-session-preparation-worker", () => ({
  executeFirstWorkingSessionPreparationForSession: execute,
  getPreparationFailureTelemetry: getTelemetry,
}));
vi.mock("@/lib/onboarding/hypothesis-reasoning-service", () => ({
  PreparationReasoningStageError: class PreparationReasoningStageError extends Error {},
}));
vi.mock("@/lib/onboarding/first-working-session-brief", () => ({
  FIRST_WORKING_SESSION_PREPARATION_VERSION: "first-working-session-preparation-v5",
  FirstWorkingSessionPreparationStageError: class FirstWorkingSessionPreparationStageError extends Error {},
}));

function query(row: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => ({ data: row, error: null });
  return chain;
}

describe("working-session preparation terminal observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockImplementation(() => query({
      id: "33333333-3333-4333-8333-333333333333",
      owner_id: "11111111-1111-4111-8111-111111111111",
      status: "scheduled",
      preparation_status: "failed",
      preparation_failure_code: "website_persistence_failed",
      preparation_attempt_count: 2,
    }));
  });

  it("logs sanitized terminal classification while preserving the owner-safe API response", async () => {
    const internal = new Error("website_persistence_failed:SECRET_DATABASE_DETAIL");
    execute.mockRejectedValue(internal);
    getTelemetry.mockReturnValue({ terminalStage: "evidence_persistence", failureCode: "website_persistence_failed", failurePersistenceSucceeded: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { POST } = await import("../../app/api/onboarding/direct-hire/working-session/[id]/prepare/route");
      const response = await POST(new NextRequest("http://localhost/prepare", { method: "POST" }), {
        params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }),
      });
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body).toEqual({ success: false, error: "preparation_failed", data: {
        workingSessionId: "33333333-3333-4333-8333-333333333333",
        preparationStatus: "failed",
        preparationFailureCode: "website_persistence_failed",
        preparationAttemptCount: 2,
      } });
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({
        event: "first_working_session_preparation_terminal_failure",
        terminalStage: "evidence_persistence",
        failureCode: "website_persistence_failed",
        failurePersistenceSucceeded: true,
      }));
      expect(JSON.stringify(logged.mock.calls)).not.toContain("SECRET_DATABASE_DETAIL");
    } finally { logged.mockRestore(); }
  });
});
