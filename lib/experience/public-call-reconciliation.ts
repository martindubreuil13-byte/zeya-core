import { processElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-processor";
import type { ElevenLabsTranscriptSegment, NormalizedElevenLabsEvent } from "@/lib/voice/events/elevenlabs-event-types";
import type { PublicExperienceSessionRow } from "./public-session-server";

type ProviderConversation = {
  agent_id?: unknown;
  conversation_id?: unknown;
  status?: unknown;
  transcript?: unknown;
  metadata?: { start_time_unix_secs?: unknown; call_duration_secs?: unknown } | null;
};

export function publicExperienceProviderConversationEvent(
  session: PublicExperienceSessionRow,
  body: ProviderConversation,
): NormalizedElevenLabsEvent | null {
  if (body.status !== "done" || body.conversation_id !== session.provider_conversation_id || typeof body.agent_id !== "string" || !session.provider_conversation_id || !session.provider_call_id) return null;
  const rawTurns = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTurns.flatMap<ElevenLabsTranscriptSegment>((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const turn = raw as { role?: unknown; message?: unknown; time_in_call_secs?: unknown };
    if ((turn.role !== "user" && turn.role !== "agent") || typeof turn.message !== "string" || !turn.message.trim()) return [];
    return [{ role: turn.role as "user" | "agent", message: turn.message.trim().slice(0, 4_000), timestamp: typeof turn.time_in_call_secs === "number" ? turn.time_in_call_secs * 1_000 : undefined }];
  });
  const started = typeof body.metadata?.start_time_unix_secs === "number" ? body.metadata.start_time_unix_secs : 1;
  const duration = typeof body.metadata?.call_duration_secs === "number" ? body.metadata.call_duration_secs : null;
  return {
    provider: "elevenlabs", providerEventType: "provider_status_reconciliation",
    eventTimestamp: Math.max(1, Math.floor(started + (duration ?? 0))), conversationId: session.provider_conversation_id,
    providerCallId: session.provider_call_id, agentId: body.agent_id,
    outcome: transcript.length ? "completed" : "completed_without_transcript", transcript, durationSeconds: duration,
    eventKey: `provider_status_reconciliation:${session.provider_conversation_id}`,
  };
}

export async function reconcilePublicExperienceCall(
  session: PublicExperienceSessionRow,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!session.provider_conversation_id || !session.provider_call_id || !["call_dispatched", "call_active"].includes(session.state)) return;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return;
  const response = await request(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(session.provider_conversation_id)}`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return;
  const body = await response.json() as ProviderConversation;
  const event = publicExperienceProviderConversationEvent(session, body);
  if (!event) return;
  await processElevenLabsWebhook(event, `provider_status_reconciliation:${session.provider_conversation_id}`);
}
