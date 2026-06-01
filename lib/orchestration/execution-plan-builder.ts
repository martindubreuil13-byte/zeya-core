// Execution Plan Builder — Deterministic work item generation
// Creates work items based on mission state and workflow position

import type { OrchestratedWorkItem, OrchestrationInput } from "./orchestration-types";
import { nanoid } from "nanoid";

// ─── Work Item Generation ───────────────────────────────────────────────────

export function buildWorkItems(input: OrchestrationInput, missionId: string): OrchestratedWorkItem[] {
  const workItems: OrchestratedWorkItem[] = [];
  const baseId = (category: string) => `${missionId}-${category.toLowerCase()}-${nanoid(8)}`;

  // Step 1: Check if mission is clear
  if (input.missionEvaluation.status === "NOT_STARTED" || input.missionEvaluation.progress === 0) {
    // Mission not yet started - no work items yet
    return workItems;
  }

  // Step 2: Check if selected leads exist in memory
  const hasSelectedLeads =
    input.memoryContext &&
    input.memoryContext.selectedLeads &&
    input.memoryContext.selectedLeads.length > 0;

  if (!hasSelectedLeads) {
    // Need founder to select leads
    workItems.push({
      id: baseId("FOUNDER_REVIEW"),
      missionId,
      title: "Founder to select priority prospects",
      description: "Founder needs to review and select which prospects to prioritize for outreach",
      category: "FOUNDER_REVIEW",
      priority: "CRITICAL",
      status: "WAITING",
      requiredCapabilities: [],
      dependsOn: [],
      dependencyMet: true,
      blockingAssumption: "Founder has leads to select from",
    });

    return workItems;
  }

  // Step 3: Check if caller brief exists
  const hasCallerBrief =
    input.memoryContext &&
    input.memoryContext.callerBrief &&
    Object.keys(input.memoryContext.callerBrief).length > 0;

  if (!hasCallerBrief) {
    // Need to prepare caller brief
    workItems.push({
      id: baseId("PREPARE_BRIEF"),
      missionId,
      title: "Prepare caller brief",
      description: "Create calling script, objection handling, and pitch based on selected leads and business positioning",
      category: "ADMIN",
      priority: "HIGH",
      status: "READY",
      requiredCapabilities: ["research", "strategy"],
      dependsOn: [],
      dependencyMet: true,
    });

    // Then founder approval
    workItems.push({
      id: baseId("BRIEF_APPROVAL"),
      missionId,
      title: "Founder approves caller brief",
      description: "Founder reviews and approves the calling brief before outreach begins",
      category: "FOUNDER_REVIEW",
      priority: "HIGH",
      status: "WAITING",
      requiredCapabilities: [],
      dependsOn: [workItems[0].id],
      dependencyMet: false,
    });

    return workItems;
  }

  // Step 4: Caller brief exists - now set up calling work
  // Check if we have call results
  const hasCallResults =
    input.memoryContext &&
    input.memoryContext.callResults &&
    input.memoryContext.selectedLeads &&
    input.memoryContext.callResults.length > input.memoryContext.selectedLeads.length * 0.5; // At least 50% of leads called

  if (!hasCallResults) {
    // Need to execute calls
    const selectedLeadsCount = input.memoryContext?.selectedLeads?.length || 0;
    workItems.push({
      id: baseId("CONTACT_PROSPECTS"),
      missionId,
      title: "Contact prospects",
      description: `Execute calls with ${selectedLeadsCount} selected prospects using prepared brief`,
      category: "CALLING",
      priority: "CRITICAL",
      status: "READY",
      requiredCapabilities: ["calling"],
      estimatedHours: selectedLeadsCount * 0.5, // 30 min per call
      dependsOn: [],
      dependencyMet: true,
    });

    // Then record results
    workItems.push({
      id: baseId("RECORD_RESULTS"),
      missionId,
      title: "Record call results",
      description: "Document call outcomes, objections, and prospect interest levels",
      category: "ANALYSIS",
      priority: "HIGH",
      status: "WAITING",
      requiredCapabilities: ["research"],
      dependsOn: [workItems[0].id],
      dependencyMet: false,
    });

    return workItems;
  }

  // Step 5: Call results exist - now analyze and review
  workItems.push({
    id: baseId("ANALYZE_RESULTS"),
    missionId,
    title: "Analyze call responses",
    description: "Evaluate patterns in prospect responses, objections, and engagement signals",
    category: "ANALYSIS",
    priority: "HIGH",
    status: "READY",
    requiredCapabilities: ["research", "analysis"],
    dependsOn: [],
    dependencyMet: true,
  });

  // Founder review of findings
  workItems.push({
    id: baseId("FOUNDER_FINDINGS_REVIEW"),
    missionId,
    title: "Founder reviews findings",
    description: "Founder reviews analysis and decides on next iteration or conclusion",
    category: "FOUNDER_REVIEW",
    priority: "HIGH",
    status: "WAITING",
    requiredCapabilities: [],
    dependsOn: [workItems[workItems.length - 1].id],
    dependencyMet: false,
  });

  return workItems;
}

// ─── Dependency Validation ──────────────────────────────────────────────────

export function validateDependencies(workItems: OrchestratedWorkItem[]): OrchestratedWorkItem[] {
  return workItems.map((item) => {
    // Check if all dependencies are satisfied (either complete or not in list)
    const dependencyMet = item.dependsOn.length === 0 || item.dependsOn.some((depId) => {
      const depItem = workItems.find((w) => w.id === depId);
      return depItem?.status === "DONE";
    });

    return {
      ...item,
      dependencyMet,
      status: dependencyMet ? (item.status === "WAITING" ? "READY" : item.status) : "BLOCKED",
      blocker: !dependencyMet ? "Waiting for dependency to complete" : item.blocker,
    };
  });
}

// ─── Work Item Sequencing ───────────────────────────────────────────────────

export function sequenceWorkItems(workItems: OrchestratedWorkItem[]): OrchestratedWorkItem[] {
  // Sort by priority (critical > high > medium > low), then by dependency order
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  // Topological sort by dependencies
  const sorted: OrchestratedWorkItem[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(item: OrchestratedWorkItem) {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) return; // Cycle detected

    visiting.add(item.id);

    // Visit dependencies first
    for (const depId of item.dependsOn) {
      const depItem = workItems.find((w) => w.id === depId);
      if (depItem) {
        visit(depItem);
      }
    }

    visiting.delete(item.id);
    visited.add(item.id);
    sorted.push(item);
  }

  // Sort by priority first, then topologically
  const byPriority = [...workItems].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  for (const item of byPriority) {
    visit(item);
  }

  return sorted;
}

// ─── Status Update Logic ─────────────────────────────────────────────────────

export function updateWorkItemStatuses(
  workItems: OrchestratedWorkItem[],
  callResults?: any[]
): OrchestratedWorkItem[] {
  return workItems.map((item) => {
    // Research items are always ready if no blocker
    if (item.category === "RESEARCH" || item.category === "ANALYSIS") {
      if (!item.blocker) {
        return { ...item, status: "READY" };
      }
    }

    // Calling items need capability match
    if (item.category === "CALLING") {
      if (!item.blocker && item.dependencyMet) {
        return { ...item, status: "READY" };
      }
    }

    // Founder review items are waiting
    if (item.category === "FOUNDER_REVIEW") {
      return { ...item, status: "WAITING" };
    }

    return item;
  });
}
