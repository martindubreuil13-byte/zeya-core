// Execution channel coordination and readiness evaluation

import type { ExecutionPlan } from "@/lib/orchestration/orchestration-types";
import type {
  ExecutionChannel,
  ExecutionRequest,
  ExecutionReadiness,
} from "./execution-types";
import { buildExecutionRequests } from "./execution-request-builder";
import { getChannelRegistry, getEnabledChannels } from "./channel-registry";
import { deriveChannelType } from "./channel-router";

// Evaluate readiness of an execution request
export function evaluateExecutionReadiness(
  request: ExecutionRequest,
  channel: ExecutionChannel | null,
  plan: ExecutionPlan
): ExecutionReadiness {
  let score = 0;
  let blocker: string | undefined;

  // Factor 1: Plan status is READY or IN_PROGRESS (20 pts)
  if (plan.status === "READY" || plan.status === "IN_PROGRESS") {
    score += 20;
  } else if (!blocker) {
    blocker = `Plan status is ${plan.status}, not READY or IN_PROGRESS`;
  }

  // Factor 2: Assignment exists (20 pts)
  if (request.assignmentId && request.assignmentId.length > 0) {
    score += 20;
  } else if (!blocker) {
    blocker = "No assignment for this work item";
  }

  // Factor 3: Channel exists (20 pts)
  if (channel !== null) {
    score += 20;
  } else if (!blocker) {
    blocker = "No channel available for this work item";
  }

  // Factor 4: Channel is enabled (20 pts)
  if (channel && channel.enabled) {
    score += 20;
  } else if (!blocker && channel) {
    blocker = `Channel ${channel.type} is not enabled`;
  }

  // Factor 5: Payload has required fields (20 pts)
  if (
    request.payload &&
    request.payload.assigneeId &&
    request.payload.workItemTitle
  ) {
    score += 20;
  } else if (!blocker) {
    blocker = "Payload missing required fields";
  }

  const blocked = score < 60 || blocker !== undefined;

  return {
    readiness: Math.max(0, score),
    blocked,
    blocker,
  };
}

// Process entire execution plan and return requests + readiness map
export function processExecutionPlan(
  plan: ExecutionPlan,
  registry: Record<string, ExecutionChannel> = getChannelRegistry() as Record<
    string,
    ExecutionChannel
  >
): {
  requests: ExecutionRequest[];
  readinessMap: Map<string, ExecutionReadiness>;
} {
  const requests = buildExecutionRequests(plan);
  const readinessMap = new Map<string, ExecutionReadiness>();

  for (const request of requests) {
    const channel = registry[request.channel] || null;
    const readiness = evaluateExecutionReadiness(request, channel, plan);
    readinessMap.set(request.id, readiness);

    // Update request status based on readiness
    if (readiness.blocked) {
      request.status = "BLOCKED";
    } else if (readiness.readiness === 100) {
      request.status = "READY";
    } else {
      request.status = "PENDING";
    }
  }

  return { requests, readinessMap };
}

// Evaluate and update request statuses in a plan
export function evaluateExecutionPlan(plan: ExecutionPlan): ExecutionRequest[] {
  const { requests } = processExecutionPlan(plan);
  return requests;
}
