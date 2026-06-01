// Orchestration Summary — Executive-facing plan overview
// Produces human-readable summaries without UI specifics

import type { ExecutionPlan, OrchestrationSummary } from "./orchestration-types";

// ─── Summary Builder ────────────────────────────────────────────────────────

export function buildOrchestrationSummary(plan: ExecutionPlan): OrchestrationSummary {
  // Work item breakdown
  const readyWork = plan.workItems
    .filter((w) => w.status === "READY" && w.category !== "FOUNDER_REVIEW")
    .map((w) => ({
      title: w.title,
      priority: w.priority,
    }));

  const waitingWork = plan.workItems
    .filter((w) => w.status === "WAITING" || w.status === "BLOCKED")
    .map((w) => ({
      title: w.title,
      waitingFor: w.blocker || "Decision required",
    }));

  // Suggested assignments
  const suggestedAssignments = plan.assignments
    .filter((a) => a.status === "READY" || a.status === "SUGGESTED")
    .map((a) => {
      const workItem = plan.workItems.find((w) => w.id === a.workItemId);
      return {
        workItemTitle: workItem?.title || "Unknown",
        assigneeName: a.assigneeName,
        reason: a.reason,
      };
    });

  // Blocker summary
  const blockerSummary = plan.blockers.map((b) => ({
    message: b.message,
    severity: b.severity,
    resolution: b.suggestedResolution,
  }));

  // Executive summary text
  const summary = buildExecutiveSummary(plan);

  return {
    status: plan.status,
    readiness: plan.readiness,
    summary,
    nextAction: plan.nextAction,
    blockers: blockerSummary,
    suggestedAssignments,
    readyWork,
    waitingWork,
    metadata: {
      workItemCount: plan.workItems.length,
      assignedCount: plan.assignments.length,
      blockedCount: plan.blockers.length,
      readyCount: plan.workItems.filter((w) => w.status === "READY").length,
    },
  };
}

// ─── Executive Summary Text ─────────────────────────────────────────────────

function buildExecutiveSummary(plan: ExecutionPlan): string {
  const parts: string[] = [];

  // Status line
  switch (plan.status) {
    case "DRAFT":
      parts.push("Plan is in draft status. Mission not yet activated.");
      break;

    case "BLOCKED":
      parts.push(`Plan is blocked. ${plan.blockers.length} blocker(s) preventing execution.`);
      const criticalBlockers = plan.blockers
        .filter((b) => b.severity === "HIGH")
        .map((b) => b.message);
      if (criticalBlockers.length > 0) {
        parts.push(`Critical: ${criticalBlockers[0]}`);
      }
      break;

    case "READY":
      parts.push(
        `Plan ready for execution. ${plan.workItems.filter((w) => w.status === "READY").length} work item(s) ready to start.`
      );
      break;

    case "IN_PROGRESS":
      const inProgress = plan.workItems.filter((w) => w.status === "ASSIGNED");
      parts.push(`${inProgress.length} work item(s) in progress. ${plan.workItems.filter((w) => w.status === "READY").length} ready to start.`);
      break;

    case "COMPLETED":
      parts.push("All work items completed.");
      break;
  }

  // Readiness indicator
  if (plan.readiness > 80) {
    parts.push("Readiness: High — all prerequisites met.");
  } else if (plan.readiness > 50) {
    parts.push(`Readiness: Moderate (${plan.readiness}%) — some prerequisites pending.`);
  } else if (plan.readiness > 0) {
    parts.push(`Readiness: Low (${plan.readiness}%) — address blockers before execution.`);
  }

  // Action summary
  if (plan.nextAction) {
    parts.push(`\nImmediate action: ${plan.nextAction}`);
  }

  return parts.join(" ");
}

// ─── Status Summary Text ─────────────────────────────────────────────────────

export function buildStatusSummary(plan: ExecutionPlan): string {
  const workItemsByStatus = {
    ready: plan.workItems.filter((w) => w.status === "READY").length,
    assigned: plan.workItems.filter((w) => w.status === "ASSIGNED" || w.status === "WAITING").length,
    blocked: plan.workItems.filter((w) => w.status === "BLOCKED").length,
    done: plan.workItems.filter((w) => w.status === "DONE").length,
  };

  const parts = [
    `Work Items: ${workItemsByStatus.ready} ready, ${workItemsByStatus.assigned} assigned, ${workItemsByStatus.blocked} blocked, ${workItemsByStatus.done} done`,
    `Assignments: ${plan.assignments.length} planned`,
    `Blockers: ${plan.blockers.length} active`,
    `Readiness: ${plan.readiness}%`,
  ];

  return parts.join(" • ");
}

// ─── Blocker Summary Text ───────────────────────────────────────────────────

export function buildBlockerSummary(plan: ExecutionPlan): string {
  if (plan.blockers.length === 0) {
    return "No blockers detected.";
  }

  const highSeverity = plan.blockers.filter((b) => b.severity === "HIGH");
  const mediumSeverity = plan.blockers.filter((b) => b.severity === "MEDIUM");

  const parts: string[] = [];

  if (highSeverity.length > 0) {
    parts.push(`🔴 ${highSeverity.length} critical blocker(s):`);
    highSeverity.forEach((b) => {
      parts.push(`  • ${b.message}`);
      parts.push(`    → ${b.suggestedResolution}`);
    });
  }

  if (mediumSeverity.length > 0) {
    parts.push(`⚠️  ${mediumSeverity.length} medium blocker(s):`);
    mediumSeverity.forEach((b) => {
      parts.push(`  • ${b.message}`);
    });
  }

  return parts.join("\n");
}

// ─── Assignment Summary Text ─────────────────────────────────────────────────

export function buildAssignmentSummary(plan: ExecutionPlan): string {
  if (plan.assignments.length === 0) {
    return "No assignments planned yet.";
  }

  const ready = plan.assignments.filter((a) => a.status === "READY");
  const blocked = plan.assignments.filter((a) => a.status === "BLOCKED");

  const parts: string[] = [
    `Total assignments: ${plan.assignments.length}`,
    `Ready: ${ready.length}`,
  ];

  if (blocked.length > 0) {
    parts.push(`Blocked: ${blocked.length}`);
  }

  if (ready.length > 0) {
    parts.push("\nReady assignments:");
    ready.forEach((a) => {
      const workItem = plan.workItems.find((w) => w.id === a.workItemId);
      parts.push(`  • ${workItem?.title || "Unknown"} → ${a.assigneeName}`);
    });
  }

  return parts.join("\n");
}

// ─── Work Item Summary Text ─────────────────────────────────────────────────

export function buildWorkItemSummary(plan: ExecutionPlan): string {
  if (plan.workItems.length === 0) {
    return "No work items generated.";
  }

  const byCategory = new Map<string, number>();
  plan.workItems.forEach((w) => {
    byCategory.set(w.category, (byCategory.get(w.category) || 0) + 1);
  });

  const byStatus = new Map<string, number>();
  plan.workItems.forEach((w) => {
    byStatus.set(w.status, (byStatus.get(w.status) || 0) + 1);
  });

  const parts: string[] = ["Work Items:"];

  // By status
  byStatus.forEach((count, status) => {
    parts.push(`  ${status}: ${count}`);
  });

  // High priority items
  const criticalItems = plan.workItems.filter((w) => w.priority === "CRITICAL");
  if (criticalItems.length > 0) {
    parts.push("\nCritical items:");
    criticalItems.forEach((w) => {
      parts.push(`  • ${w.title} [${w.status}]`);
    });
  }

  return parts.join("\n");
}

// ─── Readiness Breakdown Text ───────────────────────────────────────────────

export function buildReadinessBreakdown(plan: ExecutionPlan): string {
  const parts = [
    `Execution Readiness: ${plan.readiness}%`,
    "",
    "Scoring:",
  ];

  // Work item readiness
  const readyCount = plan.workItems.filter((w) => w.status === "READY").length;
  const totalCount = plan.workItems.length;
  if (totalCount > 0) {
    const score = Math.round((readyCount / totalCount) * 20);
    parts.push(`  Work items ready: ${score}/20 (${readyCount}/${totalCount})`);
  }

  // Assignment readiness
  const readyAssignments = plan.assignments.filter((a) => a.status === "READY").length;
  const assignmentScore = Math.round((readyAssignments / Math.max(plan.assignments.length, 1)) * 20);
  parts.push(`  Assignments ready: ${assignmentScore}/20`);

  // Blockers
  const criticalBlockers = plan.blockers.filter((b) => b.severity === "HIGH").length;
  const blockerScore = criticalBlockers === 0 ? 20 : Math.max(0, 20 - criticalBlockers * 10);
  parts.push(`  No critical blockers: ${blockerScore}/20`);

  return parts.join("\n");
}
