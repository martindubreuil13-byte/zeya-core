// Pure function — no side effects, no API calls.
// Takes data already fetched by ZeyaBriefingRoom and produces an
// operational daily brief that is narrative, contextual, and non-generic.

import type { PillData } from "./briefing-room-data";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BriefEntry {
  text: string;
}

export interface DailyBrief {
  dateLabel: string;          // "27 May · Tuesday"
  lastEngaged: string | null; // "today" | "yesterday" | "3 days ago" | null
  sections: {
    yesterday: BriefEntry[];  // empty when session was today or no history
    today: BriefEntry[];
    observations: BriefEntry[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateLabel(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "long" });
  const weekday = d.toLocaleString("en-US", { weekday: "long" });
  return `${day} ${month} · ${weekday}`;
}

function daysDiff(pastIso: string, now: Date): number {
  const past = new Date(pastIso);
  // Compare calendar days in local time, not raw ms diff
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pastDate = new Date(past.getFullYear(), past.getMonth(), past.getDate());
  return Math.round((nowDate.getTime() - pastDate.getTime()) / 86_400_000);
}

function relativeDay(diffDays: number): string {
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "last week";
  return `${Math.floor(diffDays / 7)} weeks ago`;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildDailyBrief(
  pills: PillData[],
  progressPercent: number,
  lastSessionStartedAt: string | null,
  eventCount: number,
  now = new Date(),
): DailyBrief {
  const dateLabel = formatDateLabel(now);

  const diff = lastSessionStartedAt ? daysDiff(lastSessionStartedAt, now) : null;
  const lastEngaged = diff !== null ? relativeDay(diff) : null;

  const byId = Object.fromEntries(pills.map((p) => [p.id, p]));
  const toneMissing = !byId.tone || byId.tone.status === "missing";
  const proofMissing = !byId.proof_points || byId.proof_points.status === "missing";
  const objAssumed = byId.objections?.status === "assumed";
  const pricingMissing = !byId.pricing || byId.pricing.status === "missing";
  const icpConfirmed = byId.icp?.status === "confirmed";

  // ── Yesterday ───────────────────────────────────────────────────────────────

  const yesterday: BriefEntry[] = [];

  if (diff === null) {
    yesterday.push({ text: "No prior sessions on record." });
  } else if (diff === 0) {
    // Session today — omit this section to avoid redundancy
  } else if (diff === 1) {
    const plural = eventCount !== 1 ? "s" : "";
    yesterday.push(
      eventCount > 0
        ? { text: `Onboarding session completed. ${eventCount} context event${plural} recorded.` }
        : { text: "Session completed. Business profile updated." },
    );
  } else {
    yesterday.push({
      text: `Last session was ${diff} day${diff > 1 ? "s" : ""} ago. All prior context has been preserved.`,
    });
  }

  // ── Today ────────────────────────────────────────────────────────────────────

  const today: BriefEntry[] = [];

  if (progressPercent >= 80) {
    today.push({
      text: "The business profile has sufficient context for a first controlled mission. The recommended next step is preparing the mission brief.",
    });
  } else if (toneMissing) {
    today.push({
      text: "The highest-priority gap is brand tone — how Zeya represents the business before first contact. This shapes every opening exchange. One focused question resolves it.",
    });
  } else if (proofMissing) {
    today.push({
      text: "No proof points have been established. A single concrete client outcome will materially strengthen the opening argument.",
    });
  } else if (objAssumed) {
    today.push({
      text: "Objection patterns are currently inferred from the conversation rather than confirmed directly. One explicit question closes this gap.",
    });
  } else if (pricingMissing) {
    today.push({
      text: "Pricing context is absent. Even a directional range allows Zeya to navigate early prospect conversations without overstepping.",
    });
  } else {
    today.push({
      text: "Core profile fields are in a strong position. Continue developing sales arguments and proof points before the first contact sequence.",
    });
  }

  // ── Observations ─────────────────────────────────────────────────────────────

  const observations: BriefEntry[] = [];

  if (progressPercent < 40) {
    observations.push({
      text: "Business context is still being established. Two to three focused exchanges will reach the baseline required for mission readiness.",
    });
  } else if (progressPercent >= 80) {
    observations.push({
      text: "Strategic context is sufficient to begin. Offer, audience, pain points, and objection framing are all established.",
    });
  } else {
    if (objAssumed) {
      observations.push({
        text: "Objection framing based on inference is common — founders rarely articulate objections explicitly until they have seen them repeated in the field. Worth confirming before first contact.",
      });
    }
    if (icpConfirmed && pricingMissing) {
      observations.push({
        text: "The ideal customer profile is well-defined, but pricing context is missing. This creates a gap if a prospect raises cost early in the conversation.",
      });
    }
  }

  if (observations.length === 0) {
    observations.push({ text: "No signals requiring immediate attention." });
  }

  return {
    dateLabel,
    lastEngaged,
    sections: { yesterday, today, observations },
  };
}
