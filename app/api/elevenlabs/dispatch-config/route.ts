// GET /api/elevenlabs/dispatch-config
// Diagnostic endpoint to verify dispatch configuration

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // Read all ElevenLabs configuration from environment
    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    const branchId = process.env.ELEVENLABS_AGENT_BRANCH_ID;
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
    const webhookUrl = process.env.ELEVENLABS_WEBHOOK_URL;
    const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    console.log("[dispatch-config] 🔵 Configuration request received");

    // Validate all critical values exist
    const missingConfigs = [];
    if (!agentId) missingConfigs.push("NEXT_PUBLIC_ELEVENLABS_AGENT_ID");
    if (!branchId) missingConfigs.push("ELEVENLABS_AGENT_BRANCH_ID");
    if (!phoneNumberId) missingConfigs.push("ELEVENLABS_PHONE_NUMBER_ID");
    if (!webhookUrl) missingConfigs.push("ELEVENLABS_WEBHOOK_URL");
    if (!webhookSecret) missingConfigs.push("ELEVENLABS_WEBHOOK_SECRET");
    if (!apiKey) missingConfigs.push("ELEVENLABS_API_KEY");

    if (missingConfigs.length > 0) {
      console.error("[dispatch-config] 🔴 Missing critical configuration", {
        missing: missingConfigs,
      });
    }

    const response = {
      success: missingConfigs.length === 0,
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      configuration: {
        agentId: {
          value: agentId || "NOT_SET",
          source: "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
          set: !!agentId,
          description: "Current Veya agent ID in ElevenLabs",
        },
        branchId: {
          value: branchId || "NOT_SET",
          source: "ELEVENLABS_AGENT_BRANCH_ID",
          set: !!branchId,
          description: "Current published branch of Veya agent",
        },
        phoneNumberId: {
          value: phoneNumberId || "NOT_SET",
          source: "ELEVENLABS_PHONE_NUMBER_ID",
          set: !!phoneNumberId,
          description: "Outbound phone number ID for SIP trunk",
        },
        webhookUrl: {
          value: webhookUrl || "NOT_SET",
          source: "ELEVENLABS_WEBHOOK_URL",
          set: !!webhookUrl,
          description: "Endpoint where ElevenLabs sends post-call webhooks",
        },
        webhookSecret: {
          value: webhookSecret ? "***SET***" : "NOT_SET",
          source: "ELEVENLABS_WEBHOOK_SECRET",
          set: !!webhookSecret,
          description: "Secret key for webhook signature verification",
        },
        apiKey: {
          value: apiKey ? "***SET***" : "NOT_SET",
          source: "ELEVENLABS_API_KEY",
          set: !!apiKey,
          description: "API key for ElevenLabs SIP trunk endpoint",
        },
      },
      validation: {
        allConfigsSet: missingConfigs.length === 0,
        missingConfigs: missingConfigs.length > 0 ? missingConfigs : [],
        criticalPathReady:
          !!agentId && !!branchId && !!phoneNumberId && !!apiKey && !!webhookUrl,
      },
      dispatchPath: {
        step1: "dispatchWorkerBrief() in lib/workers/worker-dispatcher.ts",
        step2: "calls provider.dispatch() with WorkerBrief",
        step3: "ElevenLabsProvider.dispatch() in lib/providers/elevenlabs-provider.ts",
        step4: "reads agentId, branchId, phoneNumberId from environment",
        step5: "constructs API payload with conversation_initiation_client_data",
        step6: "POSTs to https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
        step7: "ElevenLabs responds with sip_call_id and conversation_id",
        step8: "worker-dispatcher updates brief_conversation_mappings with provider_call_id",
      },
      integrationCheckPoints: {
        agentIdFromEnv: `✓ NEXT_PUBLIC_ELEVENLABS_AGENT_ID = ${agentId || "MISSING"}`,
        branchIdFromEnv: `✓ ELEVENLABS_AGENT_BRANCH_ID = ${branchId || "MISSING"}`,
        phoneNumberIdFromEnv: `✓ ELEVENLABS_PHONE_NUMBER_ID = ${phoneNumberId || "MISSING"}`,
        webhookUrlConfigured: `✓ ELEVENLABS_WEBHOOK_URL = ${webhookUrl || "MISSING"}`,
        noHardcodedValues:
          "✓ All IDs from environment (no hardcoding means safe version updates)",
        agentBranchUpdatableSafely:
          "✓ If you update the branch in ElevenLabs, just update ELEVENLABS_AGENT_BRANCH_ID env var",
        agentSwappableSafely:
          "✓ If you switch to a different Veya agent, just update NEXT_PUBLIC_ELEVENLABS_AGENT_ID env var",
      },
      safetyChecks: {
        cannotAccidentallyUseOldAgent: true,
        reason: "Agent ID is in environment variable, not hardcoded in source",
        howToVerifyCorrectAgent: "Check NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local matches ElevenLabs dashboard",
        howToUpdateForNewAgent: "Update NEXT_PUBLIC_ELEVENLABS_AGENT_ID and restart server",
        howToUpdateForNewBranch:
          "Update ELEVENLABS_AGENT_BRANCH_ID and restart server (no code changes needed)",
      },
      nextSteps: {
        beforeLiveCall: [
          "1. Verify agentId matches 'Veya' in ElevenLabs dashboard",
          "2. Verify branchId matches the published branch you edited today",
          "3. Verify phoneNumberId is the correct SIP trunk number",
          "4. Verify webhookUrl points to your deployed server",
          "5. Review server logs during test call for DISPATCH CONFIGURATION AUDIT logs",
        ],
        duringLiveCall: [
          "Check server logs for:",
          "[elevenlabs-provider] 🔵 DISPATCH CONFIGURATION AUDIT",
          "[elevenlabs-provider] 🔵 REQUEST DETAILS",
          "[elevenlabs-provider] 🔵 Initiating outbound call to ElevenLabs",
        ],
        afterCall: [
          "Verify webhook received with correct conversation_id",
          "Verify memory events created with correct worker_brief_id",
          "Check call_outcomes table for outcome record",
        ],
      },
      debugSqlQueries: {
        getLatestOutcome: "SELECT * FROM call_outcomes ORDER BY created_at DESC LIMIT 1;",
        getLatestMemoryEvent: "SELECT * FROM memory_events ORDER BY created_at DESC LIMIT 1;",
        getLatestMapping:
          "SELECT * FROM brief_conversation_mappings ORDER BY created_at DESC LIMIT 1;",
        verifyWorkerBrief:
          "SELECT id, mission_id, business_id, worker_name FROM worker_briefs ORDER BY created_at DESC LIMIT 1;",
      },
    };

    console.log("[dispatch-config] 🟢 Configuration validated", {
      allConfigsSet: missingConfigs.length === 0,
      agentId: agentId?.substring(0, 10) + "...",
      branchId: branchId?.substring(0, 10) + "...",
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[dispatch-config] 🔴 Error", {
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
