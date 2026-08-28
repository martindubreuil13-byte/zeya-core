import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";
import { getValidatedEnvironment, type ValidatedEnvironment } from "./environment-validation";

const ELEVENLABS_SIP_TRUNK_ENDPOINT = "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";

export type ElevenLabsDispatchConfiguration = {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  agentBranchId: string;
};

export function resolveElevenLabsDispatchConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): ElevenLabsDispatchConfiguration | null {
  const apiKey = env.ELEVENLABS_API_KEY;
  const agentId = env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const phoneNumberId = env.ELEVENLABS_PHONE_NUMBER_ID;
  const agentBranchId = env.ELEVENLABS_AGENT_BRANCH_ID;
  if (!apiKey || !agentId || !phoneNumberId || !agentBranchId) return null;
  return {
    apiKey,
    agentId,
    phoneNumberId,
    agentBranchId,
  };
}

export function buildElevenLabsDispatchPayload(
  request: ProviderDispatchRequest,
  config: ElevenLabsDispatchConfiguration,
  environment: ValidatedEnvironment,
) {
  const dynamicVariables: Record<string, unknown> = {
    ...request.dynamicVariables,
    target: request.targetName || "prospect",
    targetPhone: request.targetPhone,
    missionObjective: request.dynamicVariables.missionObjective ?? request.objective,
    opening: request.dynamicVariables.opening ?? request.dynamicVariables.missionObjective ?? request.objective,
  };
  return {
    payload: {
      agent_id: config.agentId,
      agent_phone_number_id: config.phoneNumberId,
      to_number: request.targetPhone,
      conversation_initiation_client_data: {
        environment,
        user_id: request.workerBriefId,
        branch_id: config.agentBranchId,
        dynamic_variables: dynamicVariables,
      },
    },
    dynamicVariables,
  };
}

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

function redactPhone(value: string | null): string | null {
  if (!value) return null;
  return value.length > 4 ? `${value.slice(0, 2)}…${value.slice(-2)}` : "[redacted]";
}

function redactSensitiveText(value: string, phone: string): string {
  return value.replaceAll(phone, "[redacted phone]");
}

function redactProviderPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clientData = payload.conversation_initiation_client_data as Record<string, unknown> | undefined;
  const dynamicVariables = clientData?.dynamic_variables as Record<string, unknown> | undefined;
  return {
    ...payload,
    to_number: redactPhone(typeof payload.to_number === "string" ? payload.to_number : null),
    conversation_initiation_client_data: clientData
      ? {
          ...clientData,
          dynamic_variables: dynamicVariables
            ? { ...dynamicVariables, targetPhone: "[redacted]", phone: "[redacted]" }
            : dynamicVariables,
        }
      : clientData,
  };
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

    // Validate environment FIRST (FAIL CLOSED)
    let environment;
    try {
      environment = getValidatedEnvironment();
    } catch (err) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: err instanceof Error ? err.message : "Environment configuration invalid",
        createdAt: new Date().toISOString(),
      };
    }

    const config = resolveElevenLabsDispatchConfiguration();
    if (!config) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ElevenLabs dispatch configuration is incomplete",
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const { payload, dynamicVariables } = buildElevenLabsDispatchPayload(request, config, environment);
      const { apiKey, agentId, agentBranchId, phoneNumberId } = config;

      const redactedPayload = redactProviderPayload(payload);
      const isProduction = process.env.NODE_ENV === "production";

      console.log("[elevenlabs-provider] 🔵 Initiating outbound call to ElevenLabs", {
        targetPhone: redactPhone(request.targetPhone),
        workerBriefId: request.workerBriefId,
        endpoint: ELEVENLABS_SIP_TRUNK_ENDPOINT,
        dynamicVariableCount: Object.keys(dynamicVariables).length,
        environment,
      });

      const payloadJson = JSON.stringify(payload);
      if (!isProduction) {
        console.log("[elevenlabs-provider] 🔵 DISPATCH CONFIGURATION AUDIT", {
          agentId,
          agentBranchId,
          phoneNumberId,
          environment,
        });
        console.log("[elevenlabs-provider] 🔵 REQUEST DETAILS", {
          workerBriefId: request.workerBriefId,
          missionId: request.missionId,
          targetPhone: redactPhone(request.targetPhone),
          hasTargetName: Boolean(request.targetName),
          hasObjective: Boolean(request.objective),
        });
        console.log("[elevenlabs-provider] 🔵 Provider payload shape", {
          keys: Object.keys(redactedPayload).sort(),
          dynamicVariableKeys: Object.keys(dynamicVariables).sort(),
        });
        console.log("[elevenlabs-provider] 🔵 Dynamic variable audit", {
          count: Object.keys(dynamicVariables).length,
          keys: Object.keys(dynamicVariables).sort(),
        });
      }

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
      if (!response.ok) {
        const failureMessage = redactSensitiveText(
          responseFailureMessage(response.status, responseBody),
          request.targetPhone,
        );
        console.error("[elevenlabs-provider] 🔴 ElevenLabs API error", {
          status: response.status,
          errorCategory: "provider_http_error",
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
        toNumber: redactPhone(request.targetPhone),
        workerBriefId: request.workerBriefId,
      });

      return {
        providerType: "ELEVENLABS",
        providerCallId: data.sip_call_id || data.conversation_id,
        conversationId: data.conversation_id,
        status: "DISPATCHED",
        message: `Outbound call initiated (conversation: ${data.conversation_id})`,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = exceptionMessage(error);
      console.error("[elevenlabs-provider] 🔴 Exception", {
        failureReason: message,
        targetPhone: redactPhone(request.targetPhone),
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
