// Worker Selector — Choose which worker agent to dispatch a brief to

import type { WorkerBrief } from "./worker-brief-types";

export interface WorkerSelection {
  workerName: string;
  workerType: string;
  selected: boolean;
  reason: string;
}

export function selectWorkerForBrief(brief: WorkerBrief): WorkerSelection {
  if (brief.workerType === "CALLER") {
    return {
      workerName: "Veya",
      workerType: "CALLER",
      selected: true,
      reason: "Veya is the designated worker for CALLER briefings",
    };
  }

  if (brief.workerType === "RESEARCHER") {
    return {
      workerName: "Nova",
      workerType: "RESEARCHER",
      selected: false,
      reason: "RESEARCHER worker type not yet implemented",
    };
  }

  if (brief.workerType === "OUTREACH") {
    return {
      workerName: "Echo",
      workerType: "OUTREACH",
      selected: false,
      reason: "OUTREACH worker type not yet implemented",
    };
  }

  if (brief.workerType === "SCHEDULER") {
    return {
      workerName: "Sage",
      workerType: "SCHEDULER",
      selected: false,
      reason: "SCHEDULER worker type not yet implemented",
    };
  }

  if (brief.workerType === "ANALYST") {
    return {
      workerName: "Iris",
      workerType: "ANALYST",
      selected: false,
      reason: "ANALYST worker type not yet implemented",
    };
  }

  throw new Error(`Unsupported worker type: ${brief.workerType}`);
}
