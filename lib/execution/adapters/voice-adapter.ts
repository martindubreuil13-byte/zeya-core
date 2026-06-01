// Voice adapter — handles VOICE channel execution requests

import type { ExecutionRequest, ExecutionChannelType } from "../execution-types";
import type {
  ExecutionAdapter,
  ExecutionAdapterStatus,
  ExecutionProviderType,
  AdapterValidationResult,
  PreparedExecution,
} from "./provider-types";

export class VoiceAdapter implements ExecutionAdapter {
  provider: ExecutionProviderType = "MOCK";
  supportedChannels: ExecutionChannelType[] = ["VOICE"];
  status: ExecutionAdapterStatus = "NOT_CONFIGURED";

  canHandle(request: ExecutionRequest): boolean {
    return request.channel === "VOICE";
  }

  validate(request: ExecutionRequest): AdapterValidationResult {
    const missingFields: string[] = [];
    const warnings: string[] = [];
    let blocker: string | undefined;

    // Check: request is VOICE type
    if (request.channel !== "VOICE") {
      blocker = "Request is not a VOICE request";
      return { valid: false, blocker, missingFields, warnings };
    }

    // Check: objective exists and non-empty
    if (!request.objective || request.objective.trim().length === 0) {
      missingFields.push("objective");
    }

    // Check: assigneeId exists
    if (!request.payload?.assigneeId) {
      missingFields.push("assigneeId");
    }

    // Warning: Provider not configured
    warnings.push(
      "No real voice provider configured. Execution will be simulated."
    );

    // Warning: conversational brief missing
    if (!request.payload?.conversationalBrief) {
      warnings.push(
        "No conversational brief provided — voice context may be limited."
      );
    }

    const valid = !blocker && missingFields.length === 0;
    return { valid, blocker, missingFields, warnings };
  }

  prepare(request: ExecutionRequest): PreparedExecution {
    const validation = this.validate(request);

    if (!validation.valid) {
      return {
        requestId: request.id,
        provider: this.provider,
        channel: "VOICE",
        ready: false,
        instruction: "Cannot prepare voice session — validation failed",
        payload: {},
        blocker: validation.blocker || `Missing: ${validation.missingFields.join(", ")}`,
      };
    }

    const instruction = `Begin voice session for: ${request.objective}`;

    return {
      requestId: request.id,
      provider: this.provider,
      channel: "VOICE",
      ready: true,
      instruction,
      payload: {
        assigneeId: request.payload?.assigneeId,
        assigneeName: request.payload?.assigneeName,
        role: request.payload?.role,
        workItemId: request.workItemId,
        workItemTitle: request.payload?.workItemTitle,
        objective: request.objective,
        conversationalBrief: (request.payload?.conversationalBrief as string) || null,
        requiredCapabilities: request.payload?.requiredCapabilities || [],
      },
    };
  }
}
