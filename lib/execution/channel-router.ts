// Channel routing: match work items to execution channels

import type { OrchestratedWorkItem } from "@/lib/orchestration/orchestration-types";
import type { ExecutionChannel, ExecutionChannelType } from "./execution-types";
import { getChannel, getChannelRegistry } from "./channel-registry";

// Determine channel type for a work item (pure function, no registry lookup)
export function deriveChannelType(workItem: OrchestratedWorkItem): ExecutionChannelType | null {
  // Priority 1: requiredCapabilities includes voice → VOICE
  if (
    workItem.requiredCapabilities &&
    (workItem.requiredCapabilities.includes("voice") ||
      workItem.requiredCapabilities.includes("voice_briefing"))
  ) {
    return "VOICE";
  }

  // Priority 2: category is CALLING → PHONE
  if (workItem.category === "CALLING") {
    return "PHONE";
  }

  // Priority 3: category is FOLLOW_UP → EMAIL
  if (workItem.category === "FOLLOW_UP") {
    return "EMAIL";
  }

  // Priority 4: category is OUTREACH → EMAIL
  if (workItem.category === "OUTREACH") {
    return "EMAIL";
  }

  // Priority 5: RESEARCH, ANALYSIS, ADMIN, FOUNDER_REVIEW → no channel needed
  if (
    workItem.category === "RESEARCH" ||
    workItem.category === "ANALYSIS" ||
    workItem.category === "ADMIN" ||
    workItem.category === "FOUNDER_REVIEW"
  ) {
    return null;
  }

  return null;
}

// Route a work item to an enabled channel
export function routeExecutionRequest(
  workItem: OrchestratedWorkItem,
  registry: Record<ExecutionChannelType, ExecutionChannel>
): ExecutionChannel | null {
  const channelType = deriveChannelType(workItem);
  if (!channelType) {
    return null;
  }

  const channel = registry[channelType];
  if (!channel || !channel.enabled) {
    return null;
  }

  return channel;
}

// Convenience overload using default registry
export function routeExecutionRequestDefault(workItem: OrchestratedWorkItem): ExecutionChannel | null {
  return routeExecutionRequest(workItem, getChannelRegistry());
}
