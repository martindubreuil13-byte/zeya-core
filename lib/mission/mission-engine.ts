// Mission Engine — Deterministic mission evaluation and status determination
// Evaluates whether missions are succeeding based on evidence

import type { Mission, MissionStatus, Evidence, MissionEvaluation } from "./mission-types";
import {
  calculateMissionProgressComposition,
  getEvidenceBreakdown,
  analyzeEvidenceGaps,
  assessMissionStrength,
} from "./mission-progress";

// ─── Mission Status Determination ────────────────────────────────────────────

export function determineMissionStatus(
  mission: Mission,
  evidence: Evidence[]
): MissionStatus {
  // If mission is paused, keep it paused
  if (mission.status === "PAUSED") {
    return "PAUSED";
  }

  // If mission is already completed, keep status
  if (mission.status === "CONFIRMED" || mission.status === "FAILED") {
    return mission.status;
  }

  // No evidence: NOT_STARTED
  if (evidence.length === 0) {
    return "NOT_STARTED";
  }

  const breakdown = getEvidenceBreakdown(evidence);
  const totalEvidence = evidence.length;

  // Status determination rules
  if (totalEvidence < 3) {
    return "ACTIVE"; // Started but not enough evidence
  }

  if (breakdown.contradicting === 0 && breakdown.supporting >= 3) {
    // All supporting evidence and enough of it
    return "CONFIRMED";
  }

  if (breakdown.supporting === 0 && breakdown.contradicting >= 3) {
    // All contradicting evidence
    return "FAILED";
  }

  if (breakdown.contradicting > breakdown.supporting * 2) {
    // Much more contradicting than supporting
    return "FAILED";
  }

  // Mixed or accumulating evidence
  return "VALIDATING";
}

// ─── Open Questions Derivation ──────────────────────────────────────────────

export function deriveMissionOpenQuestions(
  mission: Mission,
  evidence: Evidence[]
): string[] {
  const questions: string[] = [];

  const breakdown = getEvidenceBreakdown(evidence);
  const gaps = analyzeEvidenceGaps(evidence, mission.successCriteria);

  // Add gaps as questions
  questions.push(...gaps);

  // If we have objections, add clarifying questions
  if (breakdown.contradicting > 0 && breakdown.supporting === 0) {
    questions.push("What would change the objection to a positive signal?");
    questions.push("Is this objection fundamental or could it be addressed?");
  }

  // If we have success signals mixed with objections
  if (breakdown.supporting > 0 && breakdown.contradicting > 0) {
    const ratio = (breakdown.supporting / evidence.length) * 100;
    if (ratio < 50) {
      questions.push("Why are some customers positive but others objecting?");
      questions.push("Are there different customer segments with different reactions?");
    }
  }

  // If progress is low, ask about validation approach
  if (evidence.length < 6) {
    questions.push("What's the best way to gather more evidence quickly?");
  }

  // Check for unaddressed success criteria
  if (mission.successCriteria.length > 0) {
    const criteriaAsQuestions = mission.successCriteria.map(
      (c) => `Have we validated: ${c}?`
    );
    questions.push(...criteriaAsQuestions);
  }

  return [...new Set(questions)].slice(0, 5); // Remove duplicates, limit to 5
}

// ─── Findings Extraction ────────────────────────────────────────────────────

export function deriveMissionFindings(
  mission: Mission,
  evidence: Evidence[]
): string[] {
  const findings: string[] = [];

  if (evidence.length === 0) {
    return ["No evidence collected yet"];
  }

  const breakdown = getEvidenceBreakdown(evidence);

  // Pattern findings
  if (breakdown.supporting > 0) {
    findings.push(
      `Positive signals observed in ${breakdown.supporting} evidence points`
    );
  }

  if (breakdown.contradicting > 0) {
    findings.push(
      `Objections/concerns appeared in ${breakdown.contradicting} evidence points`
    );
  }

  // Frequency findings
  const patternEvidence = evidence.filter((e) => e.type === "PATTERN");
  if (patternEvidence.length > 0) {
    const highFrequency = patternEvidence.filter((e) => e.frequency >= 3);
    if (highFrequency.length > 0) {
      findings.push(`Recurring pattern identified (${highFrequency[0].frequency}+ times)`);
    }
  }

  // Strength assessment
  const strength = assessMissionStrength(mission.progress, mission.confidence);
  if (strength === "strong") {
    findings.push("Mission hypothesis appears well-validated");
  } else if (strength === "weak") {
    findings.push("Mission hypothesis needs more evidence");
  }

  // Success criteria coverage
  if (mission.successCriteria.length > 0) {
    findings.push(
      `${Math.round((breakdown.supporting / evidence.length) * 100)}% of evidence supports success criteria`
    );
  }

  return findings;
}

// ─── Risk Identification ────────────────────────────────────────────────────

export function identifyMissionRisks(
  mission: Mission,
  evidence: Evidence[]
): string[] {
  const risks: string[] = [];

  if (evidence.length === 0) {
    risks.push("No evidence collected - mission may be blocked");
    return risks;
  }

  const breakdown = getEvidenceBreakdown(evidence);

  // High objection risk
  if (breakdown.contradicting > breakdown.supporting * 2) {
    risks.push(
      `Objections significantly outweigh positive signals (${breakdown.contradicting} vs ${breakdown.supporting})`
    );
  }

  // Evidence recency risk
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentEvidence = evidence.filter(
    (e) => new Date(e.recordedAt) > oneWeekAgo
  ).length;

  if (recentEvidence === 0 && evidence.length > 0) {
    risks.push("No evidence gathered in the past week - momentum may be lost");
  }

  // Assumption risks
  if (mission.blockingAssumptions.length > 0) {
    const unvalidatedAssumptions = mission.blockingAssumptions.filter(
      (a) =>
        !evidence.some((e) =>
          e.statement.toLowerCase().includes(a.toLowerCase())
        )
    );
    if (unvalidatedAssumptions.length > 0) {
      risks.push(
        `Key assumptions unvalidated: ${unvalidatedAssumptions.join(", ")}`
      );
    }
  }

  // Diversity risk
  const types = new Set(evidence.map((e) => e.type));
  if (types.size === 1) {
    risks.push(`Evidence only from one type (${Array.from(types)[0]})`);
  }

  return risks;
}

// ─── Next Best Action ───────────────────────────────────────────────────────

export function determineMissionNextAction(
  mission: Mission,
  evidence: Evidence[],
  status: MissionStatus
): string {
  switch (status) {
    case "NOT_STARTED":
      return "Start collecting evidence about the mission hypothesis";

    case "ACTIVE":
      if (evidence.length < 3) {
        return "Gather at least 3 evidence points before drawing conclusions";
      }
      return "Continue collecting evidence to reach VALIDATING status";

    case "VALIDATING": {
      const breakdown = getEvidenceBreakdown(evidence);
      const gaps = analyzeEvidenceGaps(evidence, mission.successCriteria);

      if (gaps.length > 0) {
        return `Address gap: ${gaps[0]}`;
      }

      if (breakdown.contradicting > breakdown.supporting) {
        return "Focus on addressing identified objections";
      }

      return "Gather more evidence to reach CONFIRMED status";
    }

    case "CONFIRMED":
      return "Mission validated - prepare to scale or move to next mission";

    case "FAILED":
      return "Mission hypothesis disproven - consider alternative approaches";

    case "PAUSED":
      return "Resume mission or confirm cancellation";

    default:
      return "Review mission status";
  }
}

// ─── Priority Recommendation ────────────────────────────────────────────────

export function recommendMissionPriority(
  evidence: Evidence[],
  status: MissionStatus,
  confidence: number
): "low" | "medium" | "high" {
  // Paused missions are low priority
  if (status === "PAUSED") {
    return "low";
  }

  // Failed missions are low priority
  if (status === "FAILED") {
    return "low";
  }

  // Active missions with little evidence and low confidence are medium
  if (status === "ACTIVE" && confidence < 40) {
    return "medium";
  }

  // Validating missions with good evidence momentum are high
  if (status === "VALIDATING" && confidence >= 60) {
    return "high";
  }

  // Confirmed missions are medium (ready to scale)
  if (status === "CONFIRMED") {
    return "medium";
  }

  // Default
  return "medium";
}

// ─── Full Mission Evaluation ─────────────────────────────────────────────────

export function evaluateMission(
  mission: Mission,
  evidence: Evidence[]
): MissionEvaluation {
  const status = determineMissionStatus(mission, evidence);
  const progress = calculateMissionProgressComposition(evidence);
  const breakdown = getEvidenceBreakdown(evidence);
  const findings = deriveMissionFindings(mission, evidence);
  const openQuestions = deriveMissionOpenQuestions(mission, evidence);
  const risks = identifyMissionRisks(mission, evidence);
  const nextAction = determineMissionNextAction(mission, evidence, status);
  const recommendedPriority = recommendMissionPriority(evidence, status, progress.confidence);

  const statusReasons: Record<MissionStatus, string> = {
    NOT_STARTED: "No evidence collected yet",
    ACTIVE: "Started but insufficient evidence to draw conclusions",
    VALIDATING: "Evidence accumulating, validating hypothesis",
    CONFIRMED: "Hypothesis well-supported by evidence",
    FAILED: "Evidence contradicts hypothesis",
    PAUSED: "Mission intentionally paused",
  };

  return {
    missionId: mission.id,
    status,
    progress: progress.progress,
    confidence: progress.confidence,
    evidenceCount: evidence.length,
    evidenceBreakdown: breakdown,
    findings,
    openQuestions,
    risks,
    nextBestAction: nextAction,
    recommendedPriority,
    statusReason: statusReasons[status],
  };
}

// ─── Status Transition Check ────────────────────────────────────────────────

export function canTransitionMissionStatus(
  from: MissionStatus,
  to: MissionStatus,
  evidence: Evidence[]
): boolean {
  // Can only move forward in the progression
  const progression: MissionStatus[] = ["NOT_STARTED", "ACTIVE", "VALIDATING", "CONFIRMED"];

  const fromIndex = progression.indexOf(from);
  const toIndex = progression.indexOf(to);

  if (toIndex > fromIndex) {
    // Check evidence requirements for transition
    if (to === "ACTIVE" && evidence.length < 1) return false;
    if (to === "VALIDATING" && evidence.length < 3) return false;
    if (to === "CONFIRMED" && evidence.length < 6) return false;
    return true;
  }

  // Can always move to FAILED or PAUSED
  if (to === "FAILED" || to === "PAUSED") {
    return true;
  }

  // Cannot move backward
  return false;
}
