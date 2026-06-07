import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";

const ELEVENLABS_SESSIONS_ENDPOINT = "https://api.elevenlabs.io/v1/convai/agents";

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

    const telnyxPhoneNumber = process.env.ELEVENLABS_OUTBOUND_PHONE_NUMBER;
    if (!telnyxPhoneNumber) {
      return {
        providerType: "ELEVENLABS",
        providerCallId: "failed_" + Date.now(),
        status: "FAILED",
        message: "ELEVENLABS_OUTBOUND_PHONE_NUMBER not configured",
        createdAt: new Date().toISOString(),
      };
    }

    try {
      // Prepare dynamic variables for ElevenLabs
      const dynamicVariables: Record<string, unknown> = {
        ...request.dynamicVariables,
        target: request.targetName || "prospect",
        targetPhone: request.targetPhone,
        objective: request.objective,
      };

      // Build the official ElevenLabs payload per Phase 12A spec
      const payload = {
        user_id: request.workerBriefId,
        deployment_id: "phone_delivery",
        conversation_config_override: {
          dynamic_variable_placeholders: dynamicVariables,
          phone: {
            phone_number_to_dial: request.targetPhone,
            from_number: telnyxPhoneNumber,
            webhook_url: "https://zeya.app/api/webhooks/elevenlabs",
            webhook_events: ["session_created", "session_started", "session_ended"],
          },
        },
      };

      console.log("[elevenlabs-provider] 🔵 Initiating outbound call", {
        agentId,
        targetPhone: request.targetPhone,
        targetName: request.targetName,
        workerBriefId: request.workerBriefId,
      });

      const response = await fetch(
        `${ELEVENLABS_SESSIONS_ENDPOINT}/${agentId}/sessions`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[elevenlabs-provider] 🔴 ElevenLabs API error", {
          status: response.status,
          error: errorText.slice(0, 200),
        });

        return {
          providerType: "ELEVENLABS",
          providerCallId: "failed_" + Date.now(),
          status: "FAILED",
          message: `ElevenLabs API error: ${response.status}`,
          createdAt: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as {
        session_id: string;
        status: string;
        phone_number_called: string;
        created_at: string;
      };

      console.log("[elevenlabs-provider] 🟢 Outbound call initiated", {
        sessionId: data.session_id,
        status: data.status,
        phoneNumberCalled: data.phone_number_called,
        workerBriefId: request.workerBriefId,
      });

      return {
        providerType: "ELEVENLABS",
        providerCallId: data.session_id,
        status: "DISPATCHED",
        message: `Outbound call initiated to ${request.targetPhone} (session: ${data.session_id})`,
        createdAt: data.created_at || new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[elevenlabs-provider] 🔴 Exception", {
        error: message,
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
