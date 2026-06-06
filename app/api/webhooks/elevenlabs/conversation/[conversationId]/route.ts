// GET /api/webhooks/elevenlabs/conversation/[conversationId] — Inspect stored conversation

import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/voice/events/elevenlabs-conversation-store";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Invalid conversation ID" },
        { status: 400 }
      );
    }

    const conversation = conversationStore.getConversation(conversationId);

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Redact sensitive information for non-development
    const isDevelopment = process.env.NODE_ENV === "development";

    // Check if this conversation is linked to a WorkerBrief
    const workerBriefId = mappingStore.getWorkerBriefId(conversationId);

    const responseBody = {
      conversationId: conversation.conversationId,
      agentId: conversation.agentId,
      status: conversation.status,
      receivedAt: conversation.receivedAt,
      eventTimestamp: conversation.eventTimestamp,
      callDuration: conversation.callDuration,
      summary: conversation.summary,
      transcriptSegmentCount: conversation.transcript.length,
      extractedDataKeys: conversation.extractedData ? Object.keys(conversation.extractedData) : [],
      userId: conversation.userId,
      agentName: conversation.agentName,
      hasAudio: conversation.hasAudio,
      hasUserAudio: conversation.hasUserAudio,
      hasResponseAudio: conversation.hasResponseAudio,
      workerBriefId: workerBriefId ?? undefined,
      ...(isDevelopment && {
        transcript: conversation.transcript,
        extractedData: conversation.extractedData,
        metadata: conversation.metadata,
      }),
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
