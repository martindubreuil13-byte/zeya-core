// Phone adapter — handles PHONE channel execution requests

import type { ExecutionRequest, ExecutionChannelType } from "../execution-types";
import type {
  ExecutionAdapter,
  ExecutionAdapterStatus,
  ExecutionProviderType,
  AdapterValidationResult,
  PreparedExecution,
} from "./provider-types";

export class PhoneAdapter implements ExecutionAdapter {
  provider: ExecutionProviderType = "MOCK";
  supportedChannels: ExecutionChannelType[] = ["PHONE"];
  status: ExecutionAdapterStatus = "NOT_CONFIGURED";

  canHandle(request: ExecutionRequest): boolean {
    return request.channel === "PHONE";
  }

  validate(request: ExecutionRequest): AdapterValidationResult {
    const missingFields: string[] = [];
    const warnings: string[] = [];
    let blocker: string | undefined;

    // Check: request is PHONE type
    if (request.channel !== "PHONE") {
      blocker = "Request is not a PHONE request";
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

    // Check: workItemTitle exists
    if (!request.payload?.workItemTitle) {
      missingFields.push("workItemTitle");
    }

    // Hard blocker: phone number required for PHONE channel
    if (!request.payload?.phoneNumber) {
      blocker = "Phone number is missing.";
    }

    // Warning: Provider not configured
    warnings.push(
      "No real phone provider configured. Execution will be simulated."
    );

    const valid = !blocker && missingFields.length === 0;
    return { valid, blocker, missingFields, warnings };
  }

  prepare(request: ExecutionRequest): PreparedExecution {
    const validation = this.validate(request);

    if (!validation.valid) {
      return {
        requestId: request.id,
        provider: this.provider,
        channel: "PHONE",
        ready: false,
        instruction: "Cannot prepare phone call — validation failed",
        payload: {},
        blocker: validation.blocker || `Missing: ${validation.missingFields.join(", ")}`,
      };
    }

    const assigneeName = (request.payload?.assigneeName as string) || "Caller";
    const instruction = `Call ${assigneeName} to: ${request.objective}`;

    return {
      requestId: request.id,
      provider: this.provider,
      channel: "PHONE",
      ready: true,
      instruction,
      payload: {
        assigneeId: request.payload?.assigneeId,
        assigneeName,
        role: request.payload?.role,
        phoneNumber: request.payload?.phoneNumber,
        workItemId: request.workItemId,
        workItemTitle: request.payload?.workItemTitle,
        objective: request.objective,
        requiredCapabilities: request.payload?.requiredCapabilities || [],
      },
    };
  }
}
