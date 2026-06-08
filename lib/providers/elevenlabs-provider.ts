import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";

const ELEVENLABS_SIP_TRUNK_ENDPOINT = "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";

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
      const dynamicVariables: Record<string, unknown> = {
        ...request.dynamicVariables,
        target: request.targetName || "prospect",
        targetPhone: request.targetPhone,
        objective: request.objective,
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

      console.log("[elevenlabs-provider] 🔵 Initiating outbound call", {
        agentId,
        targetPhone: request.targetPhone,
        targetName: request.targetName,
        workerBriefId: request.workerBriefId,
      });

      const response = await fetch(ELEVENLABS_SIP_TRUNK_ENDPOINT, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

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
