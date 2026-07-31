export const OWNER_ENTRY_PATH = "/formation/entry";
export const OWNER_EXPERIENCE_PATH = "/experience?entry=owner";
export const LIVING_REPRESENTATION_PATH = "/representation/living";

export type OwnerJourneyState =
  | { status: "new_owner" }
  | { status: "active_formation"; formationSessionId: string }
  | { status: "has_representation" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveOwnerJourneyPath(state: OwnerJourneyState): string | null {
  if (state.status === "new_owner") return OWNER_EXPERIENCE_PATH;
  if (state.status === "has_representation") {
    return LIVING_REPRESENTATION_PATH;
  }
  if (!UUID.test(state.formationSessionId)) return null;
  return `/formation/sessions/${state.formationSessionId}`;
}

export function isOwnerExperiencePath(search: string): boolean {
  return new URLSearchParams(search).get("entry") === "owner";
}
