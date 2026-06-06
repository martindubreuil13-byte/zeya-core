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
import {
  logWebhookReceived,
  logWebhookDuplicate,
  logValidationFailed,
  logSignatureVerificationFailed,
} from "@/lib/voice/events/elevenlabs-webhook-logger";
import { conversationStore } from "@/lib/voice/events/elevenlabs-conversation-store";

export async function POST(req: NextRequest) {
  console.log("[webhook] 🔵 Webhook route: Request received");

  try {
    // Get raw body for signature verification
    const rawBody = await req.text();
    console.log("[webhook] 🔵 Webhook route: Body received", { size: rawBody.length });

    // Verify signature if secret is configured
    const secret = getWebhookSecret();
    if (shouldVerifySignature()) {
      const signature = req.headers.get("x-elevenlabs-signature");

      if (!signature) {
        console.log("[webhook] 🔴 Webhook route: Missing signature header");
        return NextResponse.json(
          { success: false, error: "Missing signature header" },
          { status: 401 }
        );
      }

      if (!secret || !verifyElevenLabsSignature(rawBody, signature, secret)) {
        console.log("[webhook] 🔴 Webhook route: Signature verification failed");
        logSignatureVerificationFailed();
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }

      console.log("[webhook] 🟢 Webhook route: Signature verification passed");
    } else {
      console.log("[webhook] 🟡 Webhook route: Signature verification skipped (no secret configured)");
      logSignatureWarning(process.env.NODE_ENV === "development");
    }

    // Parse webhook payload
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
      console.log("[webhook] 🟢 Webhook route: JSON parsing succeeded");
    } catch (error) {
      console.log("[webhook] 🔴 Webhook route: JSON parsing failed", { error: String(error) });
      return NextResponse.json(
        { success: false, error: "Malformed JSON" },
        { status: 400 }
      );
    }

    // Validate webhook structure
    if (!isValidElevenLabsWebhook(payload)) {
      console.log("[webhook] 🔴 Webhook route: Payload validation failed");
      logValidationFailed("Invalid webhook structure or type");
      return NextResponse.json(
        { success: false, error: "Invalid webhook structure" },
        { status: 400 }
      );
    }

    const webhookData = payload as unknown as Record<string, unknown>;
    console.log("[webhook] 🟢 Webhook route: Payload validation passed", {
      type: webhookData.type,
      timestamp: webhookData.event_timestamp,
    });

    // Process the webhook
    console.log("[webhook] 🔵 Webhook route: Starting webhook processing");
    const result = await processElevenLabsWebhook(
      payload,
      payload as unknown as Record<string, unknown>
    );

    console.log("[webhook] 🔵 Webhook route: Webhook processing completed", {
      success: result.success,
      type: result.type,
      conversationId: result.conversationId,
      message: result.message,
    });

    // Log successful processing
    if (result.success) {
      if (result.duplicate) {
        console.log("[webhook] 🟡 Webhook route: Duplicate webhook detected", { conversationId: result.conversationId });
        logWebhookDuplicate(result.conversationId);
      } else {
        const conversation = conversationStore.getConversation(result.conversationId);
        if (conversation) {
          console.log("[webhook] 🟢 Webhook route: Successfully processed webhook", {
            conversationId: result.conversationId,
            outcome: (result as any).outcome,
          });
          logWebhookReceived(conversation);
        }
      }
    } else {
      console.log("[webhook] 🔴 Webhook route: Processing failed", {
        conversationId: result.conversationId,
        message: result.message,
      });
    }

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

    console.error("[webhook] 🔴 Webhook route: Unexpected error", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
