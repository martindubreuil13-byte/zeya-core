import type { CallOutcome } from "@/lib/call-outcomes";
import type { WorkerBrief } from "@/lib/workers";

import { buildDemoWorkerBriefFromDiscovery } from "./demo-brief-builder";
import { buildDemoDebrief } from "./demo-debrief-builder";
import { buildDemoDiscoverySession } from "./demo-discovery-builder";
import type { DemoDebrief } from "./demo-debrief-types";
import type { DemoDiscoveryInput, DemoDiscoverySession } from "./demo-discovery-types";
import { buildDemoLearningPatterns } from "./demo-learning-builder";
import type { DemoLearningPattern } from "./demo-learning-types";

export interface PreparedDemoExperience {
  session: DemoDiscoverySession;
  workerBrief: WorkerBrief;
  zeyaMessage: string;
}

export interface CompletedDemoExperience {
  debrief: DemoDebrief;
  learningPatterns: DemoLearningPattern[];
  finalZeyaMessage: string;
}

export function prepareDemoExperience(input: DemoDiscoveryInput): PreparedDemoExperience {
  const discoverySession = buildDemoDiscoverySession(input);
  const readySession: DemoDiscoverySession = {
    ...discoverySession,
    status: "READY_FOR_CALL",
    updatedAt: new Date().toISOString(),
  };
  const workerBrief = buildDemoWorkerBriefFromDiscovery(readySession);

  return {
    session: readySession,
    workerBrief,
    zeyaMessage:
      "You'll receive a call any moment now. Please pick up and stay on the line. When you're done, come back here and we'll review what happened together.",
  };
}

export function completeDemoExperience(
  session: DemoDiscoverySession,
  workerBrief: WorkerBrief,
  callOutcome?: CallOutcome
): CompletedDemoExperience {
  const debriefSession: DemoDiscoverySession = {
    ...session,
    status: "DEBRIEF_READY",
    updatedAt: new Date().toISOString(),
  };
  const debrief = buildDemoDebrief(debriefSession, workerBrief, callOutcome);
  const learningPatterns = buildDemoLearningPatterns(debriefSession, debrief);

  return {
    debrief,
    learningPatterns,
    finalZeyaMessage:
      "Here is what happened in the demo call, what Veya did well, and what Zeya would improve before the next call.",
  };
}
