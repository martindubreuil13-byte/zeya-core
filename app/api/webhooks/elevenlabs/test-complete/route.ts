// POST /api/webhooks/elevenlabs/test-complete
// Synthetic webhook test — proves post-call backend loop without real call

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-processor";
import { saveWorkerBrief } from "@/lib/workers/worker-brief-repository";
import { saveBriefConversationMapping } from "@/lib/voice/persistence/brief-conversation-mapping-repository";
import { getOutcomeByWorkerBriefId } from "@/lib/voice/persistence/outcome-repository";
import type { WorkerBrief } from "@/lib/workers";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface TestCompleteRequest {
  workerBriefId?: string;
  conversationId?: string;
  businessId: string;
  missionId: string;
}

function testRouteUnavailable() {
  return process.env.NODE_ENV !== "test"
    || process.env.PUBLIC_EXPERIENCE_TEST_MODE !== "true";
}

export async function POST(req: NextRequest) {
  if (testRouteUnavailable()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const errors: string[] = [];
  let mappingCreated = false;
  let webhookProcessed = false;
  let callOutcomeCreated = false;
  let memoryEventCreated = false;

  try {
    const body = (await req.json()) as TestCompleteRequest;

    console.log("[test-complete] 🔵 Synthetic webhook test endpoint entered", {
      businessId: body.businessId,
      missionId: body.missionId,
      workerBriefId: body.workerBriefId,
      conversationId: body.conversationId,
    });

    if (!body.businessId || !body.missionId) {
      return NextResponse.json(
        { error: "Missing required fields: businessId, missionId" },
        { status: 400 }
      );
    }

    const businessId = body.businessId;
    const missionId = body.missionId;
    const conversationId =
      body.conversationId || `conv_synthetic_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    let workerBriefId = body.workerBriefId;

    // Step 1: Create test WorkerBrief if not provided
    if (!workerBriefId) {
      workerBriefId = `test_brief_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const testBrief: WorkerBrief = {
        id: workerBriefId,
        missionId,
        executionRequestId: `exec_${Date.now()}`,
        workerType: "CALLER",
        workerName: "TestCaller",
        status: "READY",
        objective: "Synthetic webhook test",
        desiredOutcome: "Verify post-call backend loop",
        companyContext: "Test company",
        leadContext: "Test lead",
        keyQuestions: ["Test question?"],
        objectionGuidance: ["Test objection"],
        escalationRules: ["Test escalation"],
        toneGuidance: "Professional",
        successCriteria: "Webhook processed successfully",
        dynamicVariables: {
          target: "Test Target",
          targetPhone: "+11234567890",
          missionId,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      console.log("[test-complete] 🔵 Creating test WorkerBrief", {
        workerBriefId,
        missionId,
        businessId,
      });

      const saveResult = await saveWorkerBrief(
        testBrief,
        businessId,
        "Test Target",
        "+11234567890"
      );

      if (!saveResult.success) {
        errors.push(`Failed to create test WorkerBrief: ${saveResult.error?.message}`);
        console.error("[test-complete] 🔴 WorkerBrief creation failed", {
          error: saveResult.error?.message,
        });
      } else {
        console.log("[test-complete] 🟢 Test WorkerBrief created", { workerBriefId });
      }
    }

    // Step 2: Ensure mapping exists
    console.log("[test-complete] 🔵 Creating/updating brief_conversation_mappings", {
      workerBriefId,
      conversationId,
      businessId,
      missionId,
    });

    const mappingResult = await saveBriefConversationMapping(
      workerBriefId,
      missionId,
      businessId,
      conversationId
    );

    if (!mappingResult.success) {
      errors.push(`Failed to create mapping: ${mappingResult.error?.message}`);
      console.error("[test-complete] 🔴 Mapping creation failed", {
        error: mappingResult.error?.message,
      });
    } else {
      mappingCreated = true;
      console.log("[test-complete] 🟢 Mapping created/updated", {
        workerBriefId,
        conversationId,
      });
    }

    // Step 3: Update mapping with provider_call_id
    if (mappingCreated) {
      const { error: updateError } = await supabase
        .from("brief_conversation_mappings")
        .update({
          provider_call_id: "synthetic_provider_call",
          updated_at: new Date().toISOString(),
        })
        .eq("worker_brief_id", workerBriefId);

      if (updateError) {
        console.warn("[test-complete] ⚠️  Failed to update provider_call_id", {
          error: updateError.message,
        });
      }
    }

    // Step 4: Create synthetic ElevenLabs webhook payload
    const now = Math.floor(Date.now() / 1000);
    const fakeWebhookPayload = {
      type: "post_call_transcription",
      event_timestamp: now,
      data: {
        conversation_id: conversationId,
        agent_id: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_test",
        user_id: workerBriefId,
        status: "done" as const,
        transcript: [
          {
            role: "agent" as const,
            message:
              "Hi, this is Veya from Zeya. I am calling to verify the post-call memory loop is working correctly.",
          },
          {
            role: "user" as const,
            message:
              "Yes, I confirm this is a synthetic test call and I am interested in seeing the results of the memory event creation.",
          },
        ],
        summary:
          "Synthetic test call completed successfully. User confirmed interest and validated the post-call memory loop.",
        call_duration: 42,
        extracted_data: {
          interested: true,
          test: true,
          next_step: "Verify call outcome and memory event creation",
        },
      },
    };

    console.log("[test-complete] 🔵 Processing synthetic webhook through event processor", {
      conversationId,
      workerBriefId,
    });

    // Step 5: Feed webhook to processor
    const webhookResult = await processElevenLabsWebhook(
      fakeWebhookPayload,
      fakeWebhookPayload as Record<string, unknown>,
      workerBriefId
    );

    console.log("[test-complete] 📊 Webhook processing result", {
      success: webhookResult.success,
      type: webhookResult.type,
      conversationId: webhookResult.conversationId,
      message: webhookResult.message,
      error: webhookResult.error?.message,
    });

    if (webhookResult.success) {
      webhookProcessed = true;
      console.log("[test-complete] 🟢 Webhook processed successfully", {
        conversationId,
      });
    } else {
      errors.push(`Webhook processing failed: ${webhookResult.message}`);
      console.error("[test-complete] 🔴 Webhook processing failed", {
        error: webhookResult.message,
      });
    }

    // Step 6: Retrieve created outcome
    let latestOutcome = null;
    if (webhookProcessed) {
      console.log("[test-complete] 🔵 Retrieving call outcome", { workerBriefId });

      latestOutcome = await getOutcomeByWorkerBriefId(workerBriefId);

      if (latestOutcome) {
        callOutcomeCreated = true;
        console.log("[test-complete] 🟢 Call outcome retrieved", {
          outcomeId: latestOutcome.id,
          outcomeType: latestOutcome.outcome_type,
        });
      } else {
        console.warn("[test-complete] ⚠️  No outcome found for worker brief", { workerBriefId });
      }
    }

    // Step 7: Retrieve memory events
    let memoryEvents = [];
    if (webhookProcessed) {
      console.log("[test-complete] 🔵 Retrieving memory events", { workerBriefId });

      const { data: events, error: eventsError } = await supabase
        .from("memory_events")
        .select("*")
        .eq("worker_brief_id", workerBriefId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (eventsError) {
        console.warn("[test-complete] ⚠️  Failed to retrieve memory events", {
          error: eventsError.message,
        });
      } else if (events && events.length > 0) {
        memoryEventCreated = true;
        memoryEvents = events;
        console.log("[test-complete] 🟢 Memory events retrieved", {
          count: events.length,
          latestEventId: events[0].id,
        });
      } else {
        console.warn("[test-complete] ⚠️  No memory events found for worker brief", {
          workerBriefId,
        });
      }
    }

    // Step 8: Fetch verification queries
    const { data: recentOutcomes, error: outcomesError } = await supabase
      .from("call_outcomes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: recentMemoryEvents, error: memoryError } = await supabase
      .from("memory_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: recentMappings, error: mappingsError } = await supabase
      .from("brief_conversation_mappings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    const response = {
      success: !errors.length,
      workerBriefId,
      conversationId,
      businessId,
      missionId,
      mappingCreated,
      webhookProcessed,
      callOutcomeCreated,
      memoryEventCreated,
      latestOutcome: latestOutcome || null,
      latestMemoryEvent: memoryEvents[0] || null,
      errors,
      fakeWebhookUsed: fakeWebhookPayload,
      verificationQueries: {
        recentOutcomes: recentOutcomes || [],
        recentMemoryEvents: recentMemoryEvents || [],
        recentMappings: recentMappings || [],
      },
    };

    console.log("[test-complete] 📋 Final diagnostics", {
      success: response.success,
      mappingCreated,
      webhookProcessed,
      callOutcomeCreated,
      memoryEventCreated,
      errorCount: errors.length,
    });

    return NextResponse.json(response, {
      status: errors.length === 0 ? 200 : 207,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[test-complete] 🔴 Unexpected error", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: message,
        errors: [`Unexpected error: ${message}`],
      },
      { status: 500 }
    );
  }
}
