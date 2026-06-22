import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";

const ELEVENLABS_SIP_TRUNK_ENDPOINT = "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";

function responseFailureMessage(status: number, responseBody: string): string {
  if (!responseBody) return `ElevenLabs API error: ${status} (empty response body)`;

  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    const reason = typeof parsed.message === "string" ? parsed.message : detail;
    return `ElevenLabs API error: ${status}${reason ? ` - ${reason}` : ` - ${responseBody}`}`;
  } catch {
    return `ElevenLabs API error: ${status} - ${responseBody}`;
  }
}

function exceptionMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    return JSON.stringify(error);
  }
  return String(error);
}

export class ElevenLabsProvider implements WorkerProvider {
  async dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    if (!request.targetPhone) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ElevenLabsProvider requires targetPhone in dynamicVariables or request",
        createdAt: new Date().toISOString(),
      };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ELEVENLABS_API_KEY not configured",
        createdAt: new Date().toISOString(),
      };
    }

    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    if (!agentId) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "NEXT_PUBLIC_ELEVENLABS_AGENT_ID not configured",
        createdAt: new Date().toISOString(),
      };
    }

    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ELEVENLABS_PHONE_NUMBER_ID not configured",
        createdAt: new Date().toISOString(),
      };
    }

    const agentBranchId = process.env.ELEVENLABS_AGENT_BRANCH_ID;
    if (!agentBranchId) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ELEVENLABS_AGENT_BRANCH_ID not configured",
        createdAt: new Date().toISOString(),
      };
    }

    try {
      // Prepare dynamic variables for ElevenLabs
      // Include all variables from brief, plus endpoint-specific overrides
      const dynamicVariables: Record<string, unknown> = {
        ...request.dynamicVariables,
        // Ensure required ElevenLabs variables are present
        target: request.targetName || "prospect",
        targetPhone: request.targetPhone,
        objective: request.objective,
        missionObjective: request.objective, // Alias for ElevenLabs first message validation
      };

      // Build the ElevenLabs SIP trunk outbound call payload
      const webhookUrl = process.env.ELEVENLABS_WEBHOOK_URL || "https://zeya.app/api/webhooks/elevenlabs";

      const payload = {
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: request.targetPhone,
        conversation_initiation_client_data: {
          user_id: request.workerBriefId,
          branch_id: agentBranchId,
          dynamic_variables: dynamicVariables,
          webhook_url: webhookUrl,
        },
      };

      // Log the exact configuration being used
      console.log("[elevenlabs-provider] 🔵 DISPATCH CONFIGURATION AUDIT", {
        agentId: agentId,
        agentBranchId: agentBranchId,
        phoneNumberId: phoneNumberId,
        webhookUrl: webhookUrl,
        source: "environment variables (NEXT_PUBLIC_ELEVENLABS_AGENT_ID, ELEVENLABS_AGENT_BRANCH_ID, ELEVENLABS_PHONE_NUMBER_ID)",
      });

      console.log("[elevenlabs-provider] 🔵 REQUEST DETAILS", {
        workerBriefId: request.workerBriefId,
        missionId: request.missionId,
        targetName: request.targetName,
        targetPhone: request.targetPhone,
        objective: request.objective,
      });

      console.log("[elevenlabs-provider] 🔵 Dynamic variables being sent", {
        variableCount: Object.keys(dynamicVariables).length,
        variables: dynamicVariables,
      });

      console.log("[elevenlabs-provider] 🔵 Full ElevenLabs API payload", {
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: request.targetPhone,
        conversation_initiation_client_data: {
          user_id: request.workerBriefId,
          branch_id: agentBranchId,
          dynamic_variables: dynamicVariables,
          webhook_url: webhookUrl,
        },
      });

      console.log("[elevenlabs-provider] 🔵 Initiating outbound call to ElevenLabs", {
        agentId,
        branchId: agentBranchId,
        phoneNumberId,
        targetPhone: request.targetPhone,
        targetName: request.targetName,
        workerBriefId: request.workerBriefId,
        endpoint: ELEVENLABS_SIP_TRUNK_ENDPOINT,
        dynamicVariableCount: Object.keys(dynamicVariables).length,
      });

      // CRITICAL: Log the EXACT dynamic_variables object that will be sent
      console.log("[elevenlabs-provider] 🔴 EXACT DYNAMIC_VARIABLES BEING SENT TO ELEVENLABS", {
        dynamicVariablesCount: Object.keys(dynamicVariables).length,
        dynamicVariablesKeys: Object.keys(dynamicVariables).sort(),
        dynamicVariablesObject: dynamicVariables,
        hasMissionObjective: "missionObjective" in dynamicVariables,
        hasObjective: "objective" in dynamicVariables,
        missionObjectiveValue: dynamicVariables.missionObjective,
        objectiveValue: dynamicVariables.objective,
      });

      // CRITICAL: Log the EXACT JSON payload being sent before fetch
      const payloadJson = JSON.stringify(payload);
      console.log("[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT", {
        endpoint: ELEVENLABS_SIP_TRUNK_ENDPOINT,
        method: "POST",
        headers: {
          "xi-api-key": apiKey ? "SET" : "NOT_SET",
          "Content-Type": "application/json",
        },
        payload: payload,
        payloadJson: payloadJson,
      });

      console.log("[elevenlabs-provider] 🔴 CRITICAL CONVERSATION_INITIATION_CLIENT_DATA", {
        user_id: payload.conversation_initiation_client_data.user_id,
        branch_id: payload.conversation_initiation_client_data.branch_id,
        webhook_url: payload.conversation_initiation_client_data.webhook_url,
        dynamic_variables: payload.conversation_initiation_client_data.dynamic_variables,
        dynamic_variables_count: Object.keys(payload.conversation_initiation_client_data.dynamic_variables).length,
        dynamic_variables_keys: Object.keys(payload.conversation_initiation_client_data.dynamic_variables).sort(),
      });

      console.log("[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION", {
        agentIdBeingSent: agentId,
        branchIdBeingSent: agentBranchId,
        phoneNumberIdBeingSent: phoneNumberId,
        dynamicVariablesBeingSent: {
          count: Object.keys(dynamicVariables).length,
          keys: Object.keys(dynamicVariables),
          sample: JSON.stringify(dynamicVariables).substring(0, 500),
        },
        conversationInitiationClientData: payload.conversation_initiation_client_data,
      });

      const response = await fetch(ELEVENLABS_SIP_TRUNK_ENDPOINT, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: payloadJson,
      });

      const responseBody = await response.text();
      console.log("[elevenlabs-provider] provider response received", {
        workerBriefId: request.workerBriefId,
        status: response.status,
        ok: response.ok,
      });
      console.log("[elevenlabs-provider] provider response body", {
        workerBriefId: request.workerBriefId,
        body: responseBody,
      });

      if (!response.ok) {
        const failureMessage = responseFailureMessage(response.status, responseBody);
        console.error("[elevenlabs-provider] 🔴 ElevenLabs API error", {
          status: response.status,
          error: failureMessage,
        });

        return {
          providerType: "ELEVENLABS",
          providerCallId: "failed_" + Date.now(),
          status: "FAILED",
          message: failureMessage,
          createdAt: new Date().toISOString(),
        };
      }

      const data = JSON.parse(responseBody) as {
        success: boolean;
        message: string;
        conversation_id: string;
        sip_call_id: string;
      };

      console.log("[elevenlabs-provider] 🟢 Outbound call initiated", {
        conversationId: data.conversation_id,
        sipCallId: data.sip_call_id,
        toNumber: request.targetPhone,
        workerBriefId: request.workerBriefId,
      });

      return {
        providerType: "ELEVENLABS",
        providerCallId: data.sip_call_id || data.conversation_id,
        conversationId: data.conversation_id,
        status: "DISPATCHED",
        message: `Outbound call initiated to ${request.targetPhone} (conversation: ${data.conversation_id})`,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = exceptionMessage(error);
      console.error("[elevenlabs-provider] 🔴 Exception", {
        failureReason: message,
        targetPhone: request.targetPhone,
      });

      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: `Exception: ${message}`,
        createdAt: new Date().toISOString(),
      };
    }
  }
}
