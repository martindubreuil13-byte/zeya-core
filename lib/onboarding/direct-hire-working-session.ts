export const DIRECT_HIRE_WORKING_SESSION_STATUSES = [
  "scheduled",
  "cancelled",
  "completed",
] as const;

export type DirectHireWorkingSessionStatus =
  (typeof DIRECT_HIRE_WORKING_SESSION_STATUSES)[number];

export type DirectHireWorkingSession = {
  id: string;
  onboardingSessionId: string;
  formationSessionId: string | null;
  sessionKind: "first_working_session";
  scheduledAt: string;
  schedulingTimezone: string;
  status: DirectHireWorkingSessionStatus;
  preparationStatus: "pending" | "running" | "ready" | "partial" | "failed";
  preparationFailureCode?: string | null;
  preparationAttemptCount?: number;
};

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseFutureScheduledAt(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now) return null;
  return new Date(timestamp).toISOString();
}

export function localDateTimeInTimezoneToIso(
  value: string,
  timezone: string,
): string | null {
  if (!isValidIanaTimezone(timezone)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(
    desired[0], desired[1] - 1, desired[2], desired[3], desired[4], 0, 0,
  );
  if (!Number.isFinite(desiredUtc)) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matchingInstants: number[] = [];
  // IANA UTC offsets are bounded well inside +/- 14 hours. Search every 15
  // minutes so half-hour and quarter-hour zones are handled without guessing.
  // Zero matches means a DST gap; two matches means an ambiguous DST fold.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = desiredUtc - offsetMinutes * 60_000;
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const rendered = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (rendered === value) matchingInstants.push(candidate);
  }
  return matchingInstants.length === 1
    ? new Date(matchingInstants[0]).toISOString()
    : null;
}
