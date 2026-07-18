export function isNewPublicExperienceDispatchReservation(
  stateBeforeReservation: string,
  reservationResult: unknown,
): boolean {
  return stateBeforeReservation === "zeya_finalized"
    && reservationResult === "call_requested";
}
