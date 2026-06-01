// Orchestration Examples — Demonstrates work orchestration in action

import type { OrchestrationInput } from "./orchestration-types";
import { buildExecutionPlan } from "./work-orchestration-engine";
import { buildOrchestrationSummary } from "./orchestration-summary";

// ─── Test Scenario 1: Mission exists but no selected leads ──────────────────

export const scenario1_NoSelectedLeads: OrchestrationInput = {
  missionEvaluation: {
    status: "ACTIVE",
    progress: 10,
    confidence: 30,
    nextBestAction: "Validate target market with prospect conversations",
  },
  workforceEvaluation: {
    availableMembers: [
      {
        id: "maya-001",
        name: "Maya",
        role: "CALLER",
        capabilities: ["calling", "research"],
        currentWorkload: 20,
      },
      {
        id: "dev-001",
        name: "Dev",
        role: "RESEARCHER",
        capabilities: ["research", "analysis"],
        currentWorkload: 40,
      },
    ],
    assignedMembers: [],
    readinessScore: 75,
    executionBlocked: false,
  },
  businessState: {
    currentStage: "LEAD_GENERATION",
    blockingReason: null,
    isBlocked: false,
    dataCompleteness: {
      mission: 100,
      leads: 0, // No leads selected yet
      callerBrief: 0,
      workforce: 80,
    },
  },
  executiveGuidance: {
    immediateAction: "Get founder to select top 10 prospects to call",
  },
  conversationObjective: {
    objectiveType: "REVIEW_LEADS",
    completionCriteria: "Founder has selected 8-12 prospects for outreach",
  },
  memoryContext: {
    selectedLeads: undefined,
    callerBrief: undefined,
    callResults: [],
  },
};

export function runScenario1() {
  const plan = buildExecutionPlan(scenario1_NoSelectedLeads, "mission-001", "business-001");
  const summary = buildOrchestrationSummary(plan);

  console.log("=== SCENARIO 1: No Selected Leads ===");
  console.log(`Status: ${plan.status}`);
  console.log(`Readiness: ${plan.readiness}%`);
  console.log(`Next Action: ${plan.nextAction}`);
  console.log(`Work Items: ${plan.workItems.length}`);
  console.log(`Blockers: ${plan.blockers.length}`);
  console.log("");

  // Expected: BLOCKED status, blocker asking founder to select leads
  console.log("EXPECTED:");
  console.log("  Status: BLOCKED");
  console.log("  Next Action: 'Ask founder to select priority prospects'");
  console.log("  Blocker: FOUNDER_DECISION_REQUIRED");
}

// ─── Test Scenario 2: Selected leads exist but no caller brief ─────────────

export const scenario2_NoCallerBrief: OrchestrationInput = {
  missionEvaluation: {
    status: "ACTIVE",
    progress: 20,
    confidence: 40,
    nextBestAction: "Prepare and execute outreach campaign",
  },
  workforceEvaluation: {
    availableMembers: [
      {
        id: "maya-001",
        name: "Maya",
        role: "CALLER",
        capabilities: ["calling", "research"],
        currentWorkload: 20,
      },
      {
        id: "dev-001",
        name: "Dev",
        role: "RESEARCHER",
        capabilities: ["research", "analysis"],
        currentWorkload: 40,
      },
    ],
    assignedMembers: [],
    readinessScore: 75,
    executionBlocked: false,
  },
  businessState: {
    currentStage: "LEAD_REVIEW",
    blockingReason: null,
    isBlocked: false,
    dataCompleteness: {
      mission: 100,
      leads: 100, // Leads selected
      callerBrief: 0, // No brief yet
      workforce: 80,
    },
  },
  executiveGuidance: {
    immediateAction: "Prepare caller brief and begin outreach",
  },
  conversationObjective: {
    objectiveType: "PREPARE_CALLER_BRIEF",
    completionCriteria: "Founder approves calling script and objection handling approach",
  },
  memoryContext: {
    selectedLeads: [
      { id: "lead-001", name: "Company A" },
      { id: "lead-002", name: "Company B" },
      { id: "lead-003", name: "Company C" },
    ],
    callerBrief: undefined,
    callResults: [],
  },
};

export function runScenario2() {
  const plan = buildExecutionPlan(scenario2_NoCallerBrief, "mission-001", "business-001");
  const summary = buildOrchestrationSummary(plan);

  console.log("=== SCENARIO 2: No Caller Brief ===");
  console.log(`Status: ${plan.status}`);
  console.log(`Readiness: ${plan.readiness}%`);
  console.log(`Next Action: ${plan.nextAction}`);
  console.log(`Work Items: ${plan.workItems.length}`);
  console.log(`Assignments: ${plan.assignments.length}`);
  console.log("");
  console.log("Work Items:");
  plan.workItems.forEach((w) => {
    console.log(`  • ${w.title} [${w.status}]`);
  });
  console.log("");

  // Expected: READY status with work item to prepare brief
  console.log("EXPECTED:");
  console.log("  Status: BLOCKED (waiting for founder approval)");
  console.log("  Work Items:");
  console.log("    - Prepare caller brief [READY]");
  console.log("    - Founder approves caller brief [WAITING]");
}

// ─── Test Scenario 3: Caller brief exists, ready to call ──────────────────

export const scenario3_ReadyToCalling: OrchestrationInput = {
  missionEvaluation: {
    status: "ACTIVE",
    progress: 40,
    confidence: 50,
    nextBestAction: "Execute outreach with prepared brief",
  },
  workforceEvaluation: {
    availableMembers: [
      {
        id: "maya-001",
        name: "Maya",
        role: "CALLER",
        capabilities: ["calling", "research"],
        currentWorkload: 20,
      },
    ],
    assignedMembers: [],
    readinessScore: 85,
    executionBlocked: false,
  },
  businessState: {
    currentStage: "CALL_PREPARATION",
    blockingReason: null,
    isBlocked: false,
    dataCompleteness: {
      mission: 100,
      leads: 100,
      callerBrief: 100,
      workforce: 80,
    },
  },
  executiveGuidance: {
    immediateAction: "Assign Maya to call prospects using prepared brief",
  },
  memoryContext: {
    selectedLeads: [
      { id: "lead-001", name: "Company A", contact: "john@companya.com" },
      { id: "lead-002", name: "Company B", contact: "jane@companyb.com" },
      { id: "lead-003", name: "Company C", contact: "bob@companyc.com" },
    ],
    callerBrief: {
      pitch: "We help B2B companies validate product-market fit...",
      objectives: ["gauge interest", "understand pain points"],
      objectionHandling: { concern: "response" },
    },
    callResults: [],
  },
};

export function runScenario3() {
  const plan = buildExecutionPlan(scenario3_ReadyToCalling, "mission-001", "business-001");
  const summary = buildOrchestrationSummary(plan);

  console.log("=== SCENARIO 3: Ready to Call ===");
  console.log(`Status: ${plan.status}`);
  console.log(`Readiness: ${plan.readiness}%`);
  console.log(`Next Action: ${plan.nextAction}`);
  console.log(`Work Items: ${plan.workItems.length}`);
  console.log(`Assignments: ${plan.assignments.length}`);
  console.log("");
  console.log("Ready Work:");
  summary.readyWork.forEach((w) => {
    console.log(`  • ${w.title} [${w.priority}]`);
  });
  console.log("");
  console.log("Suggested Assignments:");
  summary.suggestedAssignments.forEach((a) => {
    console.log(`  • ${a.workItemTitle} → ${a.assigneeName}`);
    console.log(`    ${a.reason}`);
  });
  console.log("");

  // Expected: READY status with calling assignment
  console.log("EXPECTED:");
  console.log("  Status: READY");
  console.log("  Readiness: 80+%");
  console.log("  Work Items:");
  console.log("    - Contact prospects [READY]");
  console.log("    - Record call results [WAITING]");
  console.log("  Assignments:");
  console.log("    - Maya → Contact prospects");
}

// ─── Test Scenario 4: No caller available ────────────────────────────────

export const scenario4_NoCallerAvailable: OrchestrationInput = {
  missionEvaluation: {
    status: "ACTIVE",
    progress: 40,
    confidence: 50,
    nextBestAction: "Execute outreach with prepared brief",
  },
  workforceEvaluation: {
    availableMembers: [
      {
        id: "dev-001",
        name: "Dev",
        role: "RESEARCHER",
        capabilities: ["research", "analysis"],
        currentWorkload: 95, // Overloaded
      },
    ],
    assignedMembers: [],
    readinessScore: 40, // Low readiness due to no caller
    executionBlocked: true,
  },
  businessState: {
    currentStage: "OUTREACH_EXECUTION",
    blockingReason: "No available team member with calling capability",
    isBlocked: true,
    dataCompleteness: {
      mission: 100,
      leads: 100,
      callerBrief: 100,
      workforce: 20, // Workforce is a blocker
    },
  },
  executiveGuidance: {
    immediateAction: "Add or assign a caller to execute outreach",
    blockedUntil: "Caller becomes available",
  },
  memoryContext: {
    selectedLeads: [
      { id: "lead-001", name: "Company A" },
      { id: "lead-002", name: "Company B" },
    ],
    callerBrief: { pitch: "..." },
    callResults: [],
  },
};

export function runScenario4() {
  const plan = buildExecutionPlan(scenario4_NoCallerAvailable, "mission-001", "business-001");
  const summary = buildOrchestrationSummary(plan);

  console.log("=== SCENARIO 4: No Caller Available ===");
  console.log(`Status: ${plan.status}`);
  console.log(`Readiness: ${plan.readiness}%`);
  console.log(`Next Action: ${plan.nextAction}`);
  console.log(`Blockers: ${plan.blockers.length}`);
  console.log("");
  console.log("Blockers:");
  summary.blockers.forEach((b) => {
    console.log(`  • [${b.severity}] ${b.message}`);
    console.log(`    → ${b.resolution}`);
  });
  console.log("");

  // Expected: BLOCKED status due to no caller capability
  console.log("EXPECTED:");
  console.log("  Status: BLOCKED");
  console.log("  Blocker: NO_CAPABILITY - 'No available caller'");
  console.log("  Next Action: 'Add or assign a caller'");
}

// ─── Test Scenario 5: Call results exist ────────────────────────────────

export const scenario5_CallResultsExist: OrchestrationInput = {
  missionEvaluation: {
    status: "VALIDATING",
    progress: 70,
    confidence: 65,
    nextBestAction: "Analyze patterns and prepare findings",
  },
  workforceEvaluation: {
    availableMembers: [
      {
        id: "dev-001",
        name: "Dev",
        role: "RESEARCHER",
        capabilities: ["research", "analysis"],
        currentWorkload: 40,
      },
    ],
    assignedMembers: [
      {
        id: "maya-001",
        name: "Maya",
      },
    ],
    readinessScore: 80,
    executionBlocked: false,
  },
  businessState: {
    currentStage: "RESULT_REVIEW",
    blockingReason: null,
    isBlocked: false,
    dataCompleteness: {
      mission: 100,
      leads: 100,
      callerBrief: 100,
      callResults: 100,
    },
  },
  executiveGuidance: {
    immediateAction: "Analyze call results and present findings to founder",
  },
  memoryContext: {
    selectedLeads: [
      { id: "lead-001", name: "Company A" },
      { id: "lead-002", name: "Company B" },
    ],
    callerBrief: { pitch: "..." },
    callResults: [
      { leadId: "lead-001", outcome: "interested", notes: "Loved the approach" },
      { leadId: "lead-002", outcome: "objection", notes: "Concerns about pricing" },
    ],
  },
};

export function runScenario5() {
  const plan = buildExecutionPlan(scenario5_CallResultsExist, "mission-001", "business-001");
  const summary = buildOrchestrationSummary(plan);

  console.log("=== SCENARIO 5: Call Results Exist ===");
  console.log(`Status: ${plan.status}`);
  console.log(`Readiness: ${plan.readiness}%`);
  console.log(`Next Action: ${plan.nextAction}`);
  console.log(`Work Items: ${plan.workItems.length}`);
  console.log("");
  console.log("Ready Work:");
  summary.readyWork.forEach((w) => {
    console.log(`  • ${w.title} [${w.priority}]`);
  });
  console.log("");

  // Expected: READY with analysis work item
  console.log("EXPECTED:");
  console.log("  Status: READY");
  console.log("  Work Items:");
  console.log("    - Analyze call responses [READY]");
  console.log("    - Founder reviews findings [WAITING]");
}

// ─── Run all scenarios ──────────────────────────────────────────────────────

export function runAllScenarios() {
  console.log("\n📋 ORCHESTRATION ENGINE TEST SCENARIOS\n");

  runScenario1();
  console.log("\n---\n");

  runScenario2();
  console.log("\n---\n");

  runScenario3();
  console.log("\n---\n");

  runScenario4();
  console.log("\n---\n");

  runScenario5();
}
