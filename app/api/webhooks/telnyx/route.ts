/**
 * Telnyx Webhook Endpoint
 * Receives call events from Telnyx platform
 * POST /api/webhooks/telnyx
 */

import { handleWebhook } from "@/lib/dispatch/adapters/telnyx";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Handle webhook
    const result = await handleWebhook(body);

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error("[Telnyx Webhook Error]", error);
    return Response.json(
      { success: false, message: String(error) },
      { status: 400 }
    );
  }
}
