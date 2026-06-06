// Operational Summary — Human-readable summary of operational dispatch

import type { WorkerBrief, WorkerDispatchResult } from "@/lib/workers";
import type { ExecutionPlan } from "@/lib/execution-plans";
import type { OperationalIntelligenceAnalysis } from "./operational-intelligence-types";

export interface OperationalDispatchSummary {
  missionId: string;
  intent: string;
  confidence: string;
  inferredTrigger?: string;
  inferredAudience?: string;
  inferredBusinessModel?: string;
  keyTalkingPoints: string[];
  painPoints: string[];
  recommendedTone: string;
  planSummary: {
    id: string;
    title: string;
    mode: string;
    totalSteps: number;
  };
  executionSummary: {
    worker: string;
    workerCount: number;
    dispatchStatus: string;
    successfulDispatches: number;
    failedDispatches: number;
  };
  nextSteps: string;
  successCriteria: string;
  assumptions: string[];
  risks: string[];
  providerIntegration: {
    twilio: string;
    elevenLabs: string;
    memoryLoop: string;
  };
}

export function buildOperationalDispatchSummary(
  analysis: OperationalIntelligenceAnalysis,
  plan: ExecutionPlan,
  briefs: WorkerBrief[],
  dispatchResults: WorkerDispatchResult[]
): OperationalDispatchSummary {
  const successfulDispatches = dispatchResults.filter((r) => r.status === "SIMULATED").length;
  const failedDispatches = dispatchResults.filter((r) => r.status === "FAILED").length;

  // Get unique worker names from briefs (should all be Veya for now)
  const workers = briefs.length > 0
    ? Array.from(new Set(briefs.map((b) => b.workerName)))
    : [];

  let nextStepsText = "";
  if (plan.mode === "SINGLE") {
    nextStepsText = `${workers[0] || "Assigned worker"} will make the call and report findings. Results will update mission status.`;
  } else if (plan.mode === "BATCH") {
    nextStepsText = `${workers.join(" and ")} will make ${briefs.length} calls concurrently. Results will be aggregated when all complete.`;
  } else if (plan.mode === "SEQUENTIAL") {
    nextStepsText = `${workers.join(" and ")} will make ${briefs.length} calls in sequence. Each will complete before the next begins.`;
  } else {
    nextStepsText = "Awaiting execution mode configuration.";
  }

  return {
    missionId: plan.missionId,
    intent: analysis.intent,
    confidence: analysis.confidence,
    inferredTrigger: analysis.inferredTrigger,
    inferredAudience: analysis.inferredAudience,
    inferredBusinessModel: analysis.inferredBusinessModel,
    keyTalkingPoints: analysis.keyTalkingPoints,
    painPoints: analysis.inferredPainPoints,
    recommendedTone: analysis.recommendedTone,
    planSummary: {
      id: plan.id,
      title: plan.title,
      mode: plan.mode,
      totalSteps: plan.plannedSteps.length,
    },
    executionSummary: {
      worker: workers.join(", "),
      workerCount: workers.length,
      dispatchStatus: successfulDispatches > 0 ? "DISPATCHED" : "PENDING",
      successfulDispatches,
      failedDispatches,
    },
    nextSteps: nextStepsText,
    successCriteria: analysis.successCriteria,
    assumptions: analysis.assumptions,
    risks: analysis.risks,
    providerIntegration: {
      twilio: "Once phone number approved, briefs will route to real calls via Twilio. Call recordings will be captured.",
      elevenLabs: "dynamicVariables (intent, trigger, painPoints, talkingPoints) will feed ElevenLabs for personalized voice synthesis and script templating.",
      memoryLoop: "Call outcomes will create MemoryEvents. Zeya will analyze results, update business memory, and adjust strategy for next outreach.",
    },
  };
}
