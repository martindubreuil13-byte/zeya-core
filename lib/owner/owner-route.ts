export const OWNER_ENTRY_PATH = "/formation/entry";
export const OWNER_EXPERIENCE_PATH = "/experience?entry=owner";
export const DIRECT_HIRE_ONBOARDING_PATH = "/onboarding";
export const DIRECT_HIRE_PREPARATION_PATH = "/onboarding/preparation";
export const LIVING_REPRESENTATION_PATH = "/representation/living";

export type OwnerJourneyState =
  | { status: "new_owner" }
  | { status: "active_formation"; formationSessionId: string }
  | { status: "has_representation" }
  | { status: "direct_hire_employed"; onboardingState: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveOwnerJourneyPath(state: OwnerJourneyState): string | null {
  if (state.status === "new_owner") return DIRECT_HIRE_ONBOARDING_PATH;
  if (state.status === "direct_hire_employed") {
    // Profile persistence still uses the legacy database state name
    // "preparation". Until employment is accepted, resume at the hiring
    // decision; afterwards induction/appointment state is derived on the
    // preparation route.
    return state.onboardingState === "employment_accepted"
      ? DIRECT_HIRE_PREPARATION_PATH
      : DIRECT_HIRE_ONBOARDING_PATH;
  }
  if (state.status === "has_representation") {
    return LIVING_REPRESENTATION_PATH;
  }
  if (state.status === "active_formation") {
    if (!UUID.test(state.formationSessionId)) return null;
    return `/formation/sessions/${state.formationSessionId}`;
  }
  return null;
}

export function isOwnerExperiencePath(search: string): boolean {
  return new URLSearchParams(search).get("entry") === "owner";
}
