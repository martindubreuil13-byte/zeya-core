// GET /api/webhooks/elevenlabs/status — Webhook delivery status

import { NextResponse } from "next/server";
import { conversationStore } from "@/lib/voice/events/elevenlabs-conversation-store";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";

export async function GET() {
  try {
    const latestConversation = conversationStore.getLatestConversation();
    const allConversationIds = conversationStore.getConversationIdsSorted();
    const latestWorkerBriefId = latestConversation
      ? mappingStore.getWorkerBriefId(latestConversation.conversationId)
      : null;

    const conversationsWithBriefs = allConversationIds.map((convId) => ({
      conversationId: convId,
      workerBriefId: mappingStore.getWorkerBriefId(convId),
    }));

    return NextResponse.json({
      conversationsReceived: allConversationIds.length,
      latestConversationId: latestConversation?.conversationId ?? null,
      latestWorkerBriefId: latestWorkerBriefId,
      latestReceivedAt: latestConversation?.receivedAt ?? null,
      latestStatus: latestConversation?.status ?? null,
      latestDuration: latestConversation?.callDuration ?? null,
      conversationIds: allConversationIds,
      conversationsWithBriefs: conversationsWithBriefs,
      mappingsCount: conversationsWithBriefs.filter((c) => c.workerBriefId).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
