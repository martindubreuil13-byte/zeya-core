import { NextRequest, NextResponse } from "next/server";
import { captureAndExtractConversationOutput, ConversationOutputProcessingError } from "@/lib/voice/conversation-output/service";
import type { ConversationTranscriptTurn } from "@/lib/voice/conversation-output/types";
import {
  createExperienceServiceClient, findExperienceSession, isExpired, isPlausibleExperienceToken,
  PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS, PUBLIC_EXPERIENCE_MAX_TURN_CHARS, PUBLIC_EXPERIENCE_MAX_TURNS,
} from "@/lib/experience/public-session-server";

export async function POST(req: NextRequest) {
  let body: { token?: unknown; transcript?: unknown; phoneCaptured?: unknown };
  try { body = await req.json() as typeof body; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!isPlausibleExperienceToken(body.token) || !Array.isArray(body.transcript) || body.transcript.length === 0 || body.transcript.length > PUBLIC_EXPERIENCE_MAX_TURNS) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const transcript: ConversationTranscriptTurn[] = [];
  let total = 0;
  for (const turn of body.transcript) {
    if (!turn || typeof turn !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const value = turn as { role?: unknown; text?: unknown };
    if (!(["user", "assistant"] as unknown[]).includes(value.role) || typeof value.text !== "string" || !value.text.trim() || value.text.length > PUBLIC_EXPERIENCE_MAX_TURN_CHARS) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    total += value.text.length;
    transcript.push({ role: value.role === "user" ? "customer" : "agent", text: value.text.trim() });
  }
  if (total > PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS) return NextResponse.json({ error: "Invalid request." }, { status: 413 });
  if (transcript.at(-1)?.role === "agent" && body.phoneCaptured !== true) {
    return NextResponse.json({ error: "incomplete_handoff", message: "Provide a valid phone number before finalizing the Experience." }, { status: 409 });
  }

  try {
    const db = createExperienceServiceClient();
    const session = await findExperienceSession(db, body.token);
    if (!session || isExpired(session)) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
    if (session.state !== "zeya_active" && session.state !== "zeya_finalized") {
      return NextResponse.json({ error: "Experience session conflict." }, { status: 409 });
    }

      if (session.state === "zeya_finalized") {
        if (!session.zeya_conversation_output_id) {
          throw new Error("finalized conversation output is unavailable");
        }

        const existingOutput = await db
          .from("voice_conversation_outputs")
          .select("transcript,transcript_status")
          .eq("id", session.zeya_conversation_output_id)
          .maybeSingle();

        if (existingOutput.error || !existingOutput.data) {
          throw new Error("finalized conversation output is unavailable");
        }

        const storedTranscript = existingOutput.data.transcript;

        const exactReplay =
          existingOutput.data.transcript_status === "finalized"
          && Array.isArray(storedTranscript)
          && storedTranscript.length === transcript.length
          && storedTranscript.every((storedTurn, index) => {
            if (
              !storedTurn
              || typeof storedTurn !== "object"
              || Array.isArray(storedTurn)
            ) {
              return false;
            }

            const value = storedTurn as {
              role?: unknown;
              text?: unknown;
            };

            return (
              value.role === transcript[index]?.role
              && value.text === transcript[index]?.text
            );
          });

        if (exactReplay) {
          return NextResponse.json({ status: "ready_for_phone" });
        }

        return NextResponse.json(
          { error: "Experience session conflict." },
          { status: 409 }
        );
      }

      const result = await captureAndExtractConversationOutput({ db, ...(process.env.PUBLIC_EXPERIENCE_TEST_MODE === "true" ? { extractionModel: async () => [] } : {}), capture: {
      voiceContextId: session.zeya_voice_context_id,
      conversationId: `public_zeya_${session.zeya_voice_context_id}`,
      provider: "openai_realtime", channel: "zeya_realtime",
      captureSource: "authenticated_client_relay", transcriptTrustLevel: "authenticated_client_relay",
      providerAttested: false, submittedBy: session.tenant_user_id, startedAt: session.created_at, completedAt: new Date().toISOString(), transcript,
      transcriptStatus: "finalized", conversationStatus: "completed", completionReason: "public_experience_handoff",
      safeMetadata: { publicExperience: true },
    } });
    const finalized = await db.rpc("zeya_finalize_public_experience_zeya", {
      p_token_hash: session.token_hash, p_conversation_output_id: result.conversationOutputId,
    });
    if (finalized.error) throw new Error("finalization failed");
    return NextResponse.json({ status: "ready_for_phone" });
  } catch (error) {
    if (error instanceof ConversationOutputProcessingError) {
      console.error("[public-experience] Zeya conversation processing failed", {
        operation: "finalize_zeya",
        stage: error.stage,
        code: error.code,
        errorName: error.cause instanceof Error ? error.cause.name : "UnknownError",
      });
      return NextResponse.json(
        { error: error.code, stage: error.stage, message: "The conversation could not be processed. Please try again." },
        { status: error.stage === "extraction" ? 502 : 500 },
      );
    }
    const conflict = error instanceof Error && error.message.includes("conflict");
    console.error("[public-experience] Zeya finalization failed", {
      operation: "finalize_zeya",
      stage: "finalization",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: conflict ? "Experience session conflict." : "The conversation could not be finalized." },
      { status: conflict ? 409 : 500 },
    );
  }
}
