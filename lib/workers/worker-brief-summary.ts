// Worker Brief Summary — Human-readable brief summary with dispatch status

import type { WorkerBrief, WorkerDispatchResult, WorkerBriefSummary } from "./worker-brief-types";

export function buildWorkerBriefSummary(
  brief: WorkerBrief,
  dispatchResult?: WorkerDispatchResult
): WorkerBriefSummary {
  let nextSteps = "";

  if (brief.workerType === "CALLER") {
    nextSteps =
      "Zeya will wait for voice response from Veya once Twilio and ElevenLabs are configured. Response will include call transcript and outcome data.";
  } else {
    nextSteps = `Brief is ready for ${brief.workerName} to execute when ${brief.workerType} worker implementation is complete.`;
  }

  return {
    briefId: brief.id,
    workerName: brief.workerName,
    workerType: brief.workerType,
    objective: brief.objective,
    desiredOutcome: brief.desiredOutcome,
    companyContext: brief.companyContext,
    leadContext: brief.leadContext,
    successCriteria: brief.successCriteria,
    dispatchStatus: dispatchResult || null,
    nextSteps,
  };
}
