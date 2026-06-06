// POST /api/webhooks/elevenlabs — ElevenLabs post-call webhook receiver

import { NextRequest, NextResponse } from "next/server";
import { isValidElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-validator";
import { processElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-processor";
import {
  verifyElevenLabsSignature,
  shouldVerifySignature,
  getWebhookSecret,
  logSignatureWarning,
} from "@/lib/voice/events/elevenlabs-signature-verifier";

export async function POST(req: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await req.text();

    // Verify signature if secret is configured
    const secret = getWebhookSecret();
    if (shouldVerifySignature()) {
      const signature = req.headers.get("x-elevenlabs-signature");

      if (!signature) {
        return NextResponse.json(
          { success: false, error: "Missing signature header" },
          { status: 401 }
        );
      }

      if (!secret || !verifyElevenLabsSignature(rawBody, signature, secret)) {
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }
    } else {
      logSignatureWarning(process.env.NODE_ENV === "development");
    }

    // Parse webhook payload
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON" },
        { status: 400 }
      );
    }

    // Validate webhook structure
    if (!isValidElevenLabsWebhook(payload)) {
      return NextResponse.json(
        { success: false, error: "Invalid webhook structure" },
        { status: 400 }
      );
    }

    // Log raw payload in development
    if (process.env.NODE_ENV === "development") {
      const webhookData = payload as unknown as Record<string, unknown>;
      console.info("[webhook] ElevenLabs webhook received", {
        type: webhookData.type,
        timestamp: webhookData.event_timestamp,
      });
    }

    // Process the webhook
    const result = processElevenLabsWebhook(
      payload,
      payload as unknown as Record<string, unknown>
    );

    const statusCode = result.success ? 200 : 400;

    return NextResponse.json(
      {
        success: result.success,
        type: result.type,
        conversationId: result.conversationId,
        duplicate: result.duplicate,
        message: result.message,
      },
      { status: statusCode }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error("[webhook] Unexpected error:", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
