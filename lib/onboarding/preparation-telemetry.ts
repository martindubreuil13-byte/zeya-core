export type PreparationTelemetryContext = {
  workingSessionId: string;
  onboardingSessionId?: string;
  contractVersion: string;
  correlationId?: string;
};

export function logPreparationStage(
  context: PreparationTelemetryContext,
  stage: string,
  status: "started" | "completed" | "failed",
  metadata: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const entry = {
    event: "first_working_session_preparation_stage",
    preparationStage: stage,
    status,
    workingSessionId: context.workingSessionId,
    ...(context.onboardingSessionId ? { onboardingSessionId: context.onboardingSessionId } : {}),
    preparationContractVersion: context.contractVersion,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...metadata,
  };
  (status === "failed" ? console.error : console.info)(entry);
}

export function safePreparationFailureCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "preparation_failed";
  const prefix = String(error.message).split(":", 1)[0];
  return /^[a-z][a-z0-9_]{2,119}$/.test(prefix) ? prefix : "preparation_failed";
}
