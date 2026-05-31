// Mission Summary — Clean output for display and founder communication
// Transforms detailed evaluation into actionable brief

import type { Mission, MissionEvaluation, Evidence } from "./mission-types";
import { evaluateMission } from "./mission-engine";

// ─── Mission Summary ─────────────────────────────────────────────────────────

export interface MissionSummary {
  // Identification
  title: string;
  hypothesis: string;

  // Current state
  status: string; // Human-readable version
  progress: number; // 0-100
  confidence: number; // 0-100

  // Evidence
  totalEvidence: number;
  supportingEvidence: number;
  contradictingEvidence: number;

  // Key insights
  keyFinding: string; // Most important finding
  primaryRisk: string; // Most important risk
  immediateAction: string; // What to do next

  // Context
  priority: "low" | "medium" | "high";
  successProbability: "low" | "medium" | "high"; // Based on current trajectory
  openQuestions: string[]; // Top 3 questions
  blockers: string[]; // Things preventing progress
}

export function buildMissionSummary(
  mission: Mission,
  evidence: Evidence[]
): MissionSummary {
  const evaluation = evaluateMission(mission, evidence);

  // Determine success probability
  let successProbability: "low" | "medium" | "high" = "medium";
  if (evaluation.status === "CONFIRMED") {
    successProbability = "high";
  } else if (evaluation.status === "FAILED") {
    successProbability = "low";
  } else if (evaluation.confidence >= 70) {
    successProbability = "high";
  } else if (evaluation.confidence < 30) {
    successProbability = "low";
  }

  return {
    title: mission.title,
    hypothesis: mission.hypothesis,
    status: formatStatus(evaluation.status),
    progress: evaluation.progress,
    confidence: evaluation.confidence,
    totalEvidence: evaluation.evidenceCount,
    supportingEvidence: evaluation.evidenceBreakdown.supporting,
    contradictingEvidence: evaluation.evidenceBreakdown.contradicting,
    keyFinding: evaluation.findings[0] || "No findings yet",
    primaryRisk: evaluation.risks[0] || "No known risks",
    immediateAction: evaluation.nextBestAction,
    priority: evaluation.recommendedPriority,
    successProbability,
    openQuestions: evaluation.openQuestions.slice(0, 3),
    blockers: extractBlockers(mission, evaluation),
  };
}

// ─── Status Formatting ───────────────────────────────────────────────────────

function formatStatus(status: string): string {
  const formatted: Record<string, string> = {
    NOT_STARTED: "Not Started",
    ACTIVE: "Active",
    VALIDATING: "Validating",
    CONFIRMED: "Confirmed ✓",
    FAILED: "Failed ✗",
    PAUSED: "Paused",
  };
  return formatted[status] || status;
}

// ─── Progress Display ────────────────────────────────────────────────────────

export function formatProgressBar(progress: number, width: number = 20): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${" ".repeat(empty)}] ${progress}%`;
}

export function formatConfidenceBadge(confidence: number): string {
  if (confidence >= 80) return "High Confidence";
  if (confidence >= 60) return "Moderate Confidence";
  if (confidence >= 40) return "Low Confidence";
  return "Very Low Confidence";
}

// ─── Blocker Extraction ──────────────────────────────────────────────────────

function extractBlockers(
  mission: Mission,
  evaluation: MissionEvaluation
): string[] {
  const blockers: string[] = [];

  // Unvalidated assumptions
  if (mission.blockingAssumptions.length > 0) {
    blockers.push(`Unvalidated assumptions: ${mission.blockingAssumptions[0]}`);
  }

  // Insufficient evidence
  if (evaluation.evidenceCount < 3) {
    blockers.push("Insufficient evidence (need at least 3 data points)");
  }

  // High objection rate
  if (evaluation.evidenceBreakdown.contradicting > evaluation.evidenceBreakdown.supporting) {
    blockers.push("More objections than successes");
  }

  // Low confidence
  if (evaluation.confidence < 40) {
    blockers.push("Low confidence in current conclusions");
  }

  return blockers.slice(0, 2); // Top 2 blockers
}

// ─── Mission Health Check ────────────────────────────────────────────────────

export interface MissionHealth {
  overallHealth: "healthy" | "at-risk" | "critical";
  healthScore: number; // 0-100
  reasons: string[];
  recommendations: string[];
}

export function assessMissionHealth(
  mission: Mission,
  evidence: Evidence[]
): MissionHealth {
  const evaluation = evaluateMission(mission, evidence);
  const reasons: string[] = [];
  const recommendations: string[] = [];

  let healthScore = 50; // Baseline

  // Status affects health
  switch (evaluation.status) {
    case "CONFIRMED":
      healthScore += 40;
      reasons.push("✓ Hypothesis well-validated");
      break;
    case "VALIDATING":
      healthScore += 20;
      reasons.push("○ Evidence accumulating");
      break;
    case "ACTIVE":
      healthScore += 10;
      reasons.push("○ Mission active but early stage");
      break;
    case "NOT_STARTED":
      healthScore -= 20;
      reasons.push("✗ No progress yet");
      recommendations.push("Start collecting evidence");
      break;
    case "FAILED":
      healthScore -= 40;
      reasons.push("✗ Hypothesis disproven");
      recommendations.push("Reconsider mission hypothesis");
      break;
    case "PAUSED":
      healthScore = 30;
      reasons.push("⊘ Mission paused");
      break;
  }

  // Confidence affects health
  if (evaluation.confidence < 30) {
    healthScore -= 15;
    reasons.push("✗ Low confidence");
    recommendations.push("Gather more diverse evidence");
  } else if (evaluation.confidence >= 70) {
    healthScore += 10;
    reasons.push("✓ Good confidence level");
  }

  // Evidence recency affects health
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentEvidence = evidence.filter(
    (e) => new Date(e.recordedAt) > oneWeekAgo
  ).length;

  if (recentEvidence === 0 && evidence.length > 0) {
    healthScore -= 10;
    reasons.push("⚠ No recent activity");
    recommendations.push("Increase collection frequency");
  } else if (recentEvidence >= 3) {
    healthScore += 10;
    reasons.push("✓ Active evidence gathering");
  }

  // Evidence quality
  const strongEvidence = evidence.filter((e) => e.strength === "strong").length;
  if (strongEvidence === 0 && evidence.length > 0) {
    healthScore -= 10;
    reasons.push("⚠ Evidence is weak");
    recommendations.push("Seek stronger evidence");
  }

  healthScore = Math.max(0, Math.min(100, healthScore));

  const overallHealth: "healthy" | "at-risk" | "critical" =
    healthScore >= 70 ? "healthy" : healthScore >= 40 ? "at-risk" : "critical";

  return {
    overallHealth,
    healthScore,
    reasons,
    recommendations,
  };
}

// ─── Comparative Summary ─────────────────────────────────────────────────────

export interface MissionComparisonSummary {
  activeCount: number;
  confirmedCount: number;
  failedCount: number;
  averageProgress: number;
  averageConfidence: number;
  topPriority: MissionSummary | null;
  atRiskMissions: string[]; // Mission titles
}

export function compareMissions(
  missions: Array<{ mission: Mission; evidence: Evidence[] }>
): MissionComparisonSummary {
  const summaries = missions.map(({ mission, evidence }) =>
    buildMissionSummary(mission, evidence)
  );

  const evaluations = missions.map(({ mission, evidence }) =>
    evaluateMission(mission, evidence)
  );

  const atRiskMissions = evaluations
    .filter(
      (e) => e.status === "FAILED" || (e.status === "VALIDATING" && e.confidence < 30)
    )
    .map((e) => {
      const mission = missions.find((m) => m.mission.id === e.missionId);
      return mission?.mission.title || "Unknown";
    });

  const topPriority = summaries.sort((a, b) => {
    const priorityScore: Record<string, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    const scoreA = priorityScore[a.priority] + a.progress * 0.01;
    const scoreB = priorityScore[b.priority] + b.progress * 0.01;
    return scoreB - scoreA;
  })[0] || null;

  return {
    activeCount: evaluations.filter((e) => e.status === "ACTIVE").length,
    confirmedCount: evaluations.filter((e) => e.status === "CONFIRMED").length,
    failedCount: evaluations.filter((e) => e.status === "FAILED").length,
    averageProgress: Math.round(
      summaries.reduce((sum, s) => sum + s.progress, 0) / summaries.length || 0
    ),
    averageConfidence: Math.round(
      summaries.reduce((sum, s) => sum + s.confidence, 0) / summaries.length || 0
    ),
    topPriority,
    atRiskMissions,
  };
}

// ─── Status Card ─────────────────────────────────────────────────────────────

export function buildMissionCard(
  mission: Mission,
  evidence: Evidence[]
): {
  title: string;
  status: string;
  progress: string;
  confidence: string;
  evidence: string;
  action: string;
} {
  const summary = buildMissionSummary(mission, evidence);
  const evaluation = evaluateMission(mission, evidence);

  return {
    title: summary.title,
    status: summary.status,
    progress: formatProgressBar(summary.progress),
    confidence: formatConfidenceBadge(summary.confidence),
    evidence: `${summary.supportingEvidence}+ / ${evaluation.evidenceBreakdown.contradicting}− / ${summary.totalEvidence} total`,
    action: summary.immediateAction,
  };
}
