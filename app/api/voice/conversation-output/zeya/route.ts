import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { captureAndExtractConversationOutput } from "@/lib/voice/conversation-output/service";
import type { ConversationTranscriptTurn } from "@/lib/voice/conversation-output/types";
import type { ConversationExtractionModel } from "@/lib/voice/conversation-output/extractor";

function validTranscript(value: unknown): value is ConversationTranscriptTurn[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return false;
    const row = turn as Record<string, unknown>;
    return (row.role === "customer" || row.role === "agent")
      && typeof row.text === "string" && row.text.trim().length > 0 && row.text.length <= 20_000;
  });
}

export function createZeyaConversationOutputHandler(extractionModel?: ConversationExtractionModel) {
  return async function handleZeyaConversationOutput(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  let body: {
    voiceContextId?: string;
    conversationId?: string;
    transcript?: unknown;
    startedAt?: string;
    completedAt?: string;
    completionReason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Conversation output request was invalid." }, { status: 400 });
  }
  if (!body.voiceContextId || !body.conversationId || !validTranscript(body.transcript)) {
    return NextResponse.json({ error: "Conversation output request was invalid." }, { status: 400 });
  }

  const visibleLineage = await auth.supabase.from("voice_representation_lineage")
    .select("voice_context_id,conversation_id")
    .eq("voice_context_id", body.voiceContextId)
    .eq("conversation_id", body.conversationId)
    .maybeSingle();
  if (visibleLineage.error || !visibleLineage.data) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Conversation capture unavailable." }, { status: 503 });
  const trustedDb = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const result = await captureAndExtractConversationOutput({
      db: trustedDb,
      extractionModel,
      capture: {
        voiceContextId: body.voiceContextId,
        conversationId: body.conversationId,
        provider: "openai_realtime",
        channel: "zeya_realtime",
        captureSource: "authenticated_client_relay",
        transcriptTrustLevel: "authenticated_client_relay",
        providerAttested: false,
        submittedBy: auth.user.id,
        startedAt: body.startedAt ?? null,
        completedAt: body.completedAt ?? new Date().toISOString(),
        transcript: body.transcript,
        transcriptStatus: "finalized",
        conversationStatus: "completed",
        completionReason: body.completionReason ?? "user_disconnect",
        safeMetadata: { turnCount: body.transcript.length },
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const category = error instanceof Error && error.message.toLowerCase().includes("conflict") ? "conflict" : "capture_failed";
    return NextResponse.json({ error: category === "conflict" ? "Conversation output already finalized." : "Conversation capture failed." }, { status: category === "conflict" ? 409 : 500 });
  }
  };
}

export const POST = createZeyaConversationOutputHandler();
