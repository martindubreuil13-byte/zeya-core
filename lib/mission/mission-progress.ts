// Mission Progress — Deterministic progress and confidence calculation

import type { Evidence, EvidenceType, MissionProgress, ProgressStage } from "./mission-types";

// ─── Evidence Strength Scoring ───────────────────────────────────────────────

function scoreEvidence(evidence: Evidence): number {
  let score = 0;

  // Base strength
  switch (evidence.strength) {
    case "weak":
      score += 10;
      break;
    case "moderate":
      score += 25;
      break;
    case "strong":
      score += 50;
      break;
  }

  // Evidence type weight
  switch (evidence.type) {
    case "OBJECTION":
      score += 15; // Objections are important signals
      break;
    case "SUCCESS":
      score += 30; // Positive signals are strong
      break;
    case "PATTERN":
      score += 25; // Patterns are more significant than single instances
      break;
    case "METRIC":
      score += 35; // Quantitative data is strong
      break;
    case "FEEDBACK":
      score += 20;
      break;
    case "LEARNING":
      score += 18;
      break;
    case "TEST_RESULT":
      score += 40; // Deliberate tests are very valuable
      break;
    case "MARKET_SIGNAL":
      score += 25;
      break;
  }

  // Frequency multiplier (for patterns)
  if (evidence.frequency > 1) {
    score += Math.min(20, evidence.frequency * 5);
  }

  return Math.min(100, score);
}

// ─── Progress Calculation ────────────────────────────────────────────────────

export function calculateMissionProgress(allEvidence: Evidence[]): number {
  if (allEvidence.length === 0) return 0;

  // Deterministic progress based on evidence count
  const count = allEvidence.length;

  if (count === 0) return 0;
  if (count === 1) return 10;
  if (count >= 2 && count <= 5) return 25;
  if (count >= 6 && count <= 10) return 50;
  if (count >= 11 && count <= 20) return 75;
  if (count >= 21) return 100;

  return 0; // Shouldn't reach here
}

export function getProgressStage(progress: number): ProgressStage {
  if (progress === 0) return "NO_DATA";
  if (progress <= 25) return "INITIAL_EVIDENCE";
  if (progress <= 50) return "ACCUMULATING";
  if (progress <= 75) return "SUBSTANTIAL";
  return "COMPREHENSIVE";
}

export function getEvidenceRequiredForNextStage(currentProgress: number): number {
  if (currentProgress < 25) return 2; // Need 2 for first stage
  if (currentProgress < 50) return 6; // 6 total for second stage
  if (currentProgress < 75) return 11; // 11 total for third stage
  if (currentProgress < 100) return 21; // 21 total for final stage
  return 0;
}

// ─── Confidence Calculation ──────────────────────────────────────────────────

interface ConfidenceFactors {
  evidenceQuantity: number;
  evidenceQuality: number;
  evidenceDiversity: number;
  consistency: number;
}

export function calculateConfidenceFactors(
  evidence: Evidence[]
): ConfidenceFactors {
  if (evidence.length === 0) {
    return {
      evidenceQuantity: 0,
      evidenceQuality: 0,
      evidenceDiversity: 0,
      consistency: 0,
    };
  }

  // Evidence Quantity (0-100)
  const quantityScore = Math.min(100, evidence.length * 5);

  // Evidence Quality (0-100)
  const avgQuality = evidence.reduce((sum, e) => sum + scoreEvidence(e), 0) / evidence.length;
  const qualityScore = avgQuality;

  // Evidence Diversity (0-100)
  const typeSet = new Set(evidence.map((e) => e.type));
  const sourceSet = new Set(evidence.map((e) => e.source));
  const diversityScore = ((typeSet.size / 8) * 50 + (sourceSet.size / 6) * 50);

  // Consistency (0-100)
  const supporting = evidence.filter((e) => e.type === "SUCCESS").length;
  const contradicting = evidence.filter((e) => e.type === "OBJECTION").length;
  const total = evidence.length;

  let consistencyScore = 0;
  if (contradicting === 0) {
    consistencyScore = 100; // All supporting
  } else if (supporting === 0) {
    consistencyScore = 20; // All contradicting
  } else {
    // Mixed: score based on ratio of supporting to total
    consistencyScore = (supporting / total) * 100;
  }

  return {
    evidenceQuantity: Math.round(quantityScore),
    evidenceQuality: Math.round(qualityScore),
    evidenceDiversity: Math.round(Math.min(100, diversityScore)),
    consistency: Math.round(consistencyScore),
  };
}

export function calculateMissionConfidence(evidence: Evidence[]): number {
  const factors = calculateConfidenceFactors(evidence);

  // Weighted average
  const confidence =
    factors.evidenceQuantity * 0.25 +
    factors.evidenceQuality * 0.35 +
    factors.evidenceDiversity * 0.2 +
    factors.consistency * 0.2;

  return Math.round(Math.min(100, confidence));
}

// ─── Progress Composition ────────────────────────────────────────────────────

export function calculateMissionProgressComposition(
  allEvidence: Evidence[]
): MissionProgress {
  const progress = calculateMissionProgress(allEvidence);
  const stage = getProgressStage(progress);
  const confidence = calculateMissionConfidence(allEvidence);
  const factors = calculateConfidenceFactors(allEvidence);

  return {
    progress,
    progressStage: stage,
    evidenceCount: allEvidence.length,
    evidenceRequired: getEvidenceRequiredForNextStage(progress),
    confidence,
    confidenceFactors: factors,
  };
}

// ─── Evidence Filtering ──────────────────────────────────────────────────────

export function filterEvidenceByType(
  evidence: Evidence[],
  types: EvidenceType[]
): Evidence[] {
  return evidence.filter((e) => types.includes(e.type));
}

export function getEvidenceBreakdown(
  evidence: Evidence[]
): { supporting: number; contradicting: number; neutral: number } {
  return {
    supporting: evidence.filter((e) => e.type === "SUCCESS").length,
    contradicting: evidence.filter((e) => e.type === "OBJECTION").length,
    neutral: evidence.filter((e) => !["SUCCESS", "OBJECTION"].includes(e.type)).length,
  };
}

// ─── Strength Assessment ────────────────────────────────────────────────────

export function assessMissionStrength(progress: number, confidence: number): "weak" | "moderate" | "strong" {
  const combined = (progress * 0.5 + confidence * 0.5);

  if (combined < 30) return "weak";
  if (combined < 70) return "moderate";
  return "strong";
}

// ─── Readiness for Next Stage ───────────────────────────────────────────────

export function isReadyForNextStage(
  progress: number,
  confidence: number,
  stageName: string
): boolean {
  // Different stages have different requirements
  switch (stageName) {
    case "INITIAL_EVIDENCE":
      return progress >= 10 && confidence >= 20;
    case "ACCUMULATING":
      return progress >= 25 && confidence >= 40;
    case "SUBSTANTIAL":
      return progress >= 50 && confidence >= 60;
    case "COMPREHENSIVE":
      return progress >= 75 && confidence >= 75;
    default:
      return false;
  }
}

// ─── Evidence Gap Analysis ──────────────────────────────────────────────────

export function analyzeEvidenceGaps(
  evidence: Evidence[],
  successCriteria: string[]
): string[] {
  const gaps: string[] = [];

  // Check for specific evidence types that might be missing
  const types = new Set(evidence.map((e) => e.type));

  if (!types.has("TEST_RESULT")) {
    gaps.push("No deliberate test results yet");
  }

  if (!types.has("METRIC")) {
    gaps.push("No quantitative metrics collected");
  }

  if (!types.has("PATTERN")) {
    gaps.push("No recurring patterns yet (need multiple observations)");
  }

  // Check evidence diversity
  const sources = new Set(evidence.map((e) => e.source));
  if (sources.size < 2) {
    gaps.push(`Evidence only from one source (${Array.from(sources)[0]})`);
  }

  // Check consistency
  const supporting = evidence.filter((e) => e.type === "SUCCESS").length;
  const contradicting = evidence.filter((e) => e.type === "OBJECTION").length;

  if (supporting === 0 && contradicting > 0) {
    gaps.push("Only contradicting evidence (no successes yet)");
  }

  return gaps;
}

// ─── Time-Based Decay ────────────────────────────────────────────────────────

export function applyTemporalWeighting(evidence: Evidence[]): Evidence[] {
  const now = new Date();

  return evidence
    .map((e) => {
      const eventDate = new Date(e.recordedAt);
      const daysOld = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);

      // Recent evidence (< 7 days) is full strength
      // Evidence 7-30 days old is degraded
      // Evidence 30+ days old is weak
      if (daysOld <= 7) {
        return e;
      } else if (daysOld <= 30) {
        const newStrength: "weak" | "moderate" | "strong" =
          e.strength === "strong" ? "moderate" :
          e.strength === "moderate" ? "weak" :
          "weak";
        return {
          ...e,
          strength: newStrength,
        };
      } else {
        return {
          ...e,
          strength: "weak" as const,
        };
      }
    })
    .filter((e) => e.strength !== "weak" || Math.random() > 0.5); // Keep weak evidence probabilistically
}
