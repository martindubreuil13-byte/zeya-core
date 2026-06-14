/**
 * Experience Session State
 *
 * Tracks the state of a visitor's journey through the 5-beat Experience.
 * This is the source of truth for what data has been collected and where we are in the flow.
 */

import { ExperienceBeat } from "./experience-beats";

export interface ExtractionAttempt {
  value: string | null;
  confidence: number;
  timestamp: Date;
  attemptNumber: number;
  needsClarification: boolean;
}

export interface VisitorData {
  name?: string;
  phone?: string;
  business: {
    offer?: string;
    target_buyer?: string;
  };
}

export interface ExperienceSession {
  // Session metadata
  id: string;
  timestamp: Date;
  duration?: number; // milliseconds from start to completion

  // Current state
  currentBeat: ExperienceBeat;
  beatStartedAt: Date;
  beatAttempts: number;

  // Collected data
  visitor: VisitorData;
  decision?: "yes" | "no";

  // Extraction tracking
  extractions: {
    [beatName: string]: ExtractionAttempt[];
  };

  // Session status
  status: "active" | "completed" | "failed" | "abandoned";
  completionReason?: string;
}

/**
 * Initialize a new Experience session
 */
export function initializeSession(): ExperienceSession {
  return {
    id: generateSessionId(),
    timestamp: new Date(),
    currentBeat: ExperienceBeat.GREETING,
    beatStartedAt: new Date(),
    beatAttempts: 0,
    visitor: {
      business: {},
    },
    extractions: {},
    status: "active",
  };
}

/**
 * Record an extraction attempt for the current beat
 */
export function recordExtraction(
  session: ExperienceSession,
  beat: string,
  value: string | null,
  confidence: number,
  needsClarification: boolean
): void {
  if (!session.extractions[beat]) {
    session.extractions[beat] = [];
  }

  session.extractions[beat].push({
    value,
    confidence,
    timestamp: new Date(),
    attemptNumber: session.extractions[beat].length + 1,
    needsClarification,
  });
}

/**
 * Get the best extraction for a beat (highest confidence)
 */
export function getBestExtraction(
  session: ExperienceSession,
  beat: string
): ExtractionAttempt | null {
  const attempts = session.extractions[beat];
  if (!attempts || attempts.length === 0) return null;

  // Return the attempt with highest confidence that isn't null
  const nonNullAttempts = attempts.filter((a) => a.value !== null);
  if (nonNullAttempts.length === 0) return null;

  return nonNullAttempts.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );
}

/**
 * Update visitor data based on beat and extracted value
 */
export function updateVisitorData(
  session: ExperienceSession,
  beat: string,
  extractedValue: string | null
): void {
  if (!extractedValue) return;

  switch (beat) {
    case "greeting":
      session.visitor.name = extractedValue;
      break;
    case "product":
      session.visitor.business.offer = extractedValue;
      break;
    case "customer":
      session.visitor.business.target_buyer = extractedValue;
      break;
    case "experiment":
      session.decision = extractedValue === "yes" ? "yes" : "no";
      break;
    case "phone":
      session.visitor.phone = extractedValue;
      break;
  }
}

/**
 * Mark session as completed
 */
export function completeSession(
  session: ExperienceSession,
  reason: string
): void {
  session.status = "completed";
  session.completionReason = reason;
  session.duration = Date.now() - session.timestamp.getTime();
}

/**
 * Mark session as failed
 */
export function failSession(session: ExperienceSession, reason: string): void {
  session.status = "failed";
  session.completionReason = reason;
  session.duration = Date.now() - session.timestamp.getTime();
}

/**
 * Get session summary for logging/analytics
 */
export function getSessionSummary(session: ExperienceSession): {
  id: string;
  duration: number;
  status: string;
  completionReason?: string;
  dataCollected: string[];
  extractionAccuracy: number;
} {
  const dataCollected = [];
  if (session.visitor.name) dataCollected.push("name");
  if (session.visitor.business.offer) dataCollected.push("offer");
  if (session.visitor.business.target_buyer) dataCollected.push("target_buyer");
  if (session.visitor.phone) dataCollected.push("phone");

  const allExtractions = Object.values(session.extractions)
    .flat()
    .filter((e) => e.value !== null);

  const avgConfidence =
    allExtractions.length > 0
      ? allExtractions.reduce((sum, e) => sum + e.confidence, 0) /
        allExtractions.length
      : 0;

  return {
    id: session.id,
    duration: session.duration || 0,
    status: session.status,
    completionReason: session.completionReason,
    dataCollected,
    extractionAccuracy: avgConfidence,
  };
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Re-export beat enum for convenience
export { ExperienceBeat } from "./experience-beats";
