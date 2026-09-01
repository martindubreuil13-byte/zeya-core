import { FIRST_WORKING_SESSION_PREPARATION_VERSION } from "./first-working-session-brief";

export type FirstWorkingSessionPreparationState = {
  preparation_status?: string | null;
  preparation_contract_version?: string | null;
} | null | undefined;

export function isFirstWorkingSessionPreparationCurrentAndUsable(
  state: FirstWorkingSessionPreparationState,
): boolean {
  return state?.preparation_status === "ready"
    && state.preparation_contract_version === FIRST_WORKING_SESSION_PREPARATION_VERSION;
}

export function resolveOwnerFormationPrecedence(input: {
  hasActiveFormation: boolean;
  hasDirectHireOnboarding: boolean;
  authoritativeWorkingSession?: FirstWorkingSessionPreparationState;
}): "active_formation" | "direct_hire_employed" | null {
  if (!input.hasActiveFormation) {
    return input.hasDirectHireOnboarding ? "direct_hire_employed" : null;
  }
  if (!input.hasDirectHireOnboarding) return "active_formation";
  return isFirstWorkingSessionPreparationCurrentAndUsable(
    input.authoritativeWorkingSession,
  ) ? "active_formation" : "direct_hire_employed";
}
