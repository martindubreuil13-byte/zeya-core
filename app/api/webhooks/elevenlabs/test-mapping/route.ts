// POST /api/webhooks/elevenlabs/test-mapping — Register conversation-brief mapping for testing
// Required before webhook test to ensure businessId is available

import { NextRequest, NextResponse } from "next/server";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { conversationId, workerBriefId, missionId, businessId } = body;

    // Validate required fields
    if (!conversationId || !workerBriefId || !missionId || !businessId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields",
          required: ["conversationId", "workerBriefId", "missionId", "businessId"],
          received: {
            conversationId: !!conversationId,
            workerBriefId: !!workerBriefId,
            missionId: !!missionId,
            businessId: !!businessId,
          },
        },
        { status: 400 }
      );
    }

    console.log("[test-mapping] 🔵 Registering test mapping", {
      conversationId,
      workerBriefId,
      missionId,
      businessId,
    });

    // Register the mapping
    const mapping = mappingStore.createMapping(
      conversationId,
      workerBriefId,
      missionId,
      businessId
    );

    console.log("[test-mapping] 🟢 Mapping registered successfully", {
      conversationId,
      workerBriefId,
      missionId,
      businessId,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Mapping registered successfully",
        mapping,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[test-mapping] 🔴 Failed to register mapping", { message });

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    description: "Register a conversation-brief mapping for testing",
    usage: "POST a JSON payload with conversationId, workerBriefId, missionId, businessId",
    example: {
      method: "POST",
      path: "/api/webhooks/elevenlabs/test-mapping",
      body: {
        conversationId: "test_conv_12345",
        workerBriefId: "test_brief_67890",
        missionId: "test_mission_abcde",
        businessId: "550e8400-e29b-41d4-a716-446655440000",
      },
    },
    response: {
      success: true,
      message: "Mapping registered successfully",
      mapping: {
        conversationId: "test_conv_12345",
        workerBriefId: "test_brief_67890",
        missionId: "test_mission_abcde",
        businessId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: "2026-06-06T12:34:56.789Z",
      },
    },
    notes: [
      "Must be called BEFORE the webhook test",
      "conversationId must match the webhook payload conversation_id",
      "businessId must be a valid UUID",
      "This endpoint is for testing only",
    ],
  });
}
