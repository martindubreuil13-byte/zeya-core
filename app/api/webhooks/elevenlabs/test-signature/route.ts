// POST /api/webhooks/elevenlabs/test-signature — Sign and test webhook payloads
// For testing webhook signature verification without making real calls

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "ELEVENLABS_WEBHOOK_SECRET not configured" },
      { status: 400 }
    );
  }

  try {
    const body = await req.text();

    // Compute HMAC-SHA256 signature
    const signature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return NextResponse.json({
      success: true,
      payload: body,
      signature,
      headers: {
        "Content-Type": "application/json",
        "x-elevenlabs-signature": signature,
      },
      curlCommand: `curl -X POST https://${req.headers.get("host")}/api/webhooks/elevenlabs \\
  -H "Content-Type: application/json" \\
  -H "x-elevenlabs-signature: ${signature}" \\
  -d '${body}'`,
      instructions:
        "Copy the curlCommand and run it to test webhook signature verification. Should return HTTP 200.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    description: "Test endpoint for webhook signature verification",
    usage: "POST a JSON payload to receive a signed webhook request",
    example: {
      method: "POST",
      path: "/api/webhooks/elevenlabs/test-signature",
      body: {
        type: "post_call_transcription",
        event_timestamp: 1234567890,
        data: {
          conversation_id: "test_conv_123",
          agent_id: "test_agent",
          status: "done",
          transcript: [
            {
              role: "user",
              message: "Hello, is this a test?",
            },
          ],
        },
      },
    },
    response: {
      signature: "hex-encoded HMAC-SHA256",
      headers: {
        "x-elevenlabs-signature": "will be set to signature value",
      },
      curlCommand: "Ready-to-run curl command with correct signature",
    },
    testCases: [
      {
        name: "Valid signature",
        description: "Should return HTTP 200",
        command: "Use the generated curlCommand",
      },
      {
        name: "Missing signature header",
        description: "Should return HTTP 401",
        command:
          'curl -X POST /api/webhooks/elevenlabs -H "Content-Type: application/json" -d \'{"test":"data"}\'',
      },
      {
        name: "Invalid signature",
        description: "Should return HTTP 401",
        command:
          'curl -X POST /api/webhooks/elevenlabs -H "Content-Type: application/json" -H "x-elevenlabs-signature: badbadbad" -d \'{"test":"data"}\'',
      },
    ],
  });
}
