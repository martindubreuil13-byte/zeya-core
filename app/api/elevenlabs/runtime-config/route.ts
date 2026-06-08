// GET /api/elevenlabs/runtime-config
// Real-time capture of what's actually being sent to ElevenLabs right now

import { NextRequest, NextResponse } from "next/server";
import { buildWorkerBrief } from "@/lib/workers";

export async function GET(req: NextRequest) {
  try {
    console.log("[runtime-config] 🔵 Runtime configuration request");

    // Read the CURRENT environment at request time
    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    const branchId = process.env.ELEVENLABS_AGENT_BRANCH_ID;
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
    const webhookUrl = process.env.ELEVENLABS_WEBHOOK_URL;
    const outboundNumber = process.env.ELEVENLABS_OUTBOUND_PHONE_NUMBER;

    // Build an ACTUAL WorkerBrief to see REAL dynamic variables constructed
    const testBrief = buildWorkerBrief({
      missionId: "mission_runtime_config_test",
      workerType: "CALLER",
      companyContext: "Zeya Platform",
      leadContext: "Test Lead",
      objective: "Test objective for runtime config",
      desiredOutcome: "User expresses interest",
      keyQuestions: ["Question 1?"],
      objectionGuidance: ["Handle objection"],
      escalationRules: ["Rule 1"],
      successCriteria: "Success",
      toneGuidance: "Professional",
      dynamicVariables: {
        planId: "plan_example",
        stepId: "step_example",
        stepNumber: 1,
        mode: "OPERATIONAL",
        priority: "HIGH",
        intent: "initial_contact",
        confidence: 0.85,
        inferredTrigger: "outbound_campaign",
        inferredAudience: "business_owner",
        inferredBusinessModel: "saas",
        keyTalkingPoints: "Points here",
        inferredPainPoints: "Pain points here",
      },
    });

    // Get ACTUAL dynamic variables from the brief
    const actualDynamicVariables = testBrief.dynamicVariables;

    // Add provider-specific overrides (as done in elevenlabs-provider.ts)
    const simulatedDynamicVariables = {
      ...actualDynamicVariables,
      target: "Prospect Name",
      targetPhone: "+13055551234",
      missionObjective: "Test objective for runtime config",
    };

    const simulatedPayload = {
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: "+13055551234",
      conversation_initiation_client_data: {
        user_id: "brief_example_12345",
        branch_id: branchId,
        dynamic_variables: simulatedDynamicVariables,
        webhook_url: webhookUrl,
      },
    };

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",

      currentRuntimeConfig: {
        agentId: {
          value: agentId || "NOT_SET",
          source: "process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
          isPublic: true,
          description: "Agent ID sent to ElevenLabs in every outbound call",
        },
        branchId: {
          value: branchId || "NOT_SET",
          source: "process.env.ELEVENLABS_AGENT_BRANCH_ID",
          isPublic: false,
          description: "Branch ID sent in conversation_initiation_client_data",
        },
        phoneNumberId: {
          value: phoneNumberId || "NOT_SET",
          source: "process.env.ELEVENLABS_PHONE_NUMBER_ID",
          isPublic: false,
          description: "Phone number ID for outbound SIP calls",
        },
        webhookUrl: {
          value: webhookUrl || "NOT_SET",
          source: "process.env.ELEVENLABS_WEBHOOK_URL",
          isPublic: false,
          description: "Webhook endpoint for post-call events",
        },
        outboundPhoneNumber: {
          value: outboundNumber || "NOT_SET",
          source: "process.env.ELEVENLABS_OUTBOUND_PHONE_NUMBER",
          isPublic: false,
          description: "Outbound phone number (for reference)",
        },
      },

      dynamicVariableCount: Object.keys(simulatedDynamicVariables).length,
      dynamicVariableKeys: Object.keys(simulatedDynamicVariables).sort(),
      hasMissionObjective: "missionObjective" in simulatedDynamicVariables,
      actualDynamicVariablesFromBrief: {
        count: Object.keys(actualDynamicVariables).length,
        keys: Object.keys(actualDynamicVariables).sort(),
        variables: actualDynamicVariables,
      },

      simulatedPayload: {
        description:
          "This is what would be sent to ElevenLabs during an actual outbound call",
        endpoint: "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
        method: "POST",
        headers: {
          "xi-api-key": "***SET***",
          "Content-Type": "application/json",
        },
        body: simulatedPayload,
      },

      criticalQuestions: {
        "Is agent_id correct?": {
          value: agentId,
          expected: "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",
          matches: agentId === "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",
        },
        "Is branch_id correct?": {
          value: branchId,
          expected: "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
          matches: branchId === "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
        },
        "Is phone_number_id correct?": {
          value: phoneNumberId,
          expected: "phnum_7801ktbvzt2gf45as1krxpqecxtq",
          matches: phoneNumberId === "phnum_7801ktbvzt2gf45as1krxpqecxtq",
        },
        "Is webhook_url correct?": {
          value: webhookUrl,
          expected:
            "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs",
          matches:
            webhookUrl === "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs",
        },
      },

      importantNotes: {
        agentIdSource:
          "Sent as 'agent_id' in the root of the payload to ElevenLabs API",
        branchIdSource:
          "Sent as 'branch_id' inside 'conversation_initiation_client_data'",
        phoneNumberIdSource:
          "Sent as 'agent_phone_number_id' in the root of the payload",
        dynamicVariablesLocation:
          "Sent inside 'conversation_initiation_client_data.dynamic_variables'",
      },

      troubleshooting: {
        wrongAgentAnswered: {
          possibleCauses: [
            "agent_id in payload doesn't match intended agent",
            "phone_number_id might have different agent assignment in ElevenLabs",
            "branch_id might not be the published branch",
            "Dynamic variables not reaching agent (check dynamic_variables in payload)",
          ],
          howToDebug: [
            "1. Check /api/elevenlabs/runtime-config to see what's being sent",
            "2. Check server logs for 'CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT'",
            "3. Compare agent_id in logs vs ElevenLabs dashboard",
            "4. Check if phone_number_id has different agent assignment",
            "5. Verify branch_id is published in ElevenLabs",
          ],
        },
        noContextReceived: {
          possibleCauses: [
            "dynamic_variables not in payload",
            "dynamic_variables empty",
            "Agent prompt doesn't reference {{variableName}} syntax",
            "Branch might be an older version without context support",
          ],
          howToDebug: [
            "1. Check 'dynamicVariableCount' in this endpoint response",
            "2. Check server logs for 'Dynamic variables being sent' count",
            "3. If count is 0, variables not being constructed",
            "4. If count > 0 but agent doesn't use them, check agent prompt",
          ],
        },
        wrongVoice: {
          possibleCauses: [
            "Different agent with different voice assignment",
            "Phone number assignment pointing to wrong agent",
            "Branch configuration has different voice settings",
          ],
          howToDebug: [
            "1. Check agent_id being sent (from this endpoint)",
            "2. Verify in ElevenLabs dashboard that agent_id is Veya",
            "3. Check phone_number_id assignment in ElevenLabs",
            "4. Review branch_id voice settings in ElevenLabs",
          ],
        },
      },

      nextSteps: [
        "1. Call this endpoint: GET /api/elevenlabs/runtime-config",
        "2. Make a test outbound call",
        "3. Check server logs for '[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT'",
        "4. Compare actual payload to expected values in 'criticalQuestions'",
        "5. If values wrong, update .env.local and restart server",
        "6. Verify call uses correct agent",
      ],
    };

    console.log("[runtime-config] 🟢 Runtime configuration captured", {
      agentId: agentId?.substring(0, 15) + "...",
      branchId: branchId?.substring(0, 15) + "...",
      variableCount: Object.keys(simulatedDynamicVariables).length,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[runtime-config] 🔴 Error", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
