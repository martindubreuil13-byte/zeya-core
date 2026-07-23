import { processElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-processor";
import type { ElevenLabsTranscriptSegment, NormalizedElevenLabsEvent } from "@/lib/voice/events/elevenlabs-event-types";
import type { PublicExperienceSessionRow } from "./public-session-server";

type ProviderConversation = {
  agent_id?: unknown;
  conversation_id?: unknown;
  status?: unknown;
  transcript?: unknown;
  metadata?: { start_time_unix_secs?: unknown; call_duration_secs?: unknown; cost?: unknown; charging?: { credits?: unknown; llm_credits?: unknown } } | null;
  analysis?: { transcript_summary?: unknown; evaluation_criteria_results?: unknown } | null;
};

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type PublicCallReconciliationResult = {
  providerStatus: string;
  normalized: boolean;
  completionProcessed: boolean;
};

export function publicExperienceProviderConversationEvent(
  session: PublicExperienceSessionRow,
  body: ProviderConversation,
): NormalizedElevenLabsEvent | null {
  if (body.status !== "done" || body.conversation_id !== session.provider_conversation_id || typeof body.agent_id !== "string" || !session.provider_conversation_id || !session.provider_call_id) return null;
  const rawTurns = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTurns.flatMap<ElevenLabsTranscriptSegment>((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const turn = raw as { role?: unknown; message?: unknown; time_in_call_secs?: unknown; conversation_turn_metrics?: Record<string, unknown>; sentiment?: unknown };
    if ((turn.role !== "user" && turn.role !== "agent") || typeof turn.message !== "string" || !turn.message.trim()) return [];
    const metrics = turn.conversation_turn_metrics ?? {};
    return [{ role: turn.role as "user" | "agent", message: turn.message.trim().slice(0, 4_000), timestamp: typeof turn.time_in_call_secs === "number" ? turn.time_in_call_secs * 1_000 : undefined, metrics: {
      asrLatencyMs: finite(metrics.asr_latency_secs) !== undefined ? finite(metrics.asr_latency_secs)! * 1_000 : undefined,
      llmLatencyMs: finite(metrics.llm_latency_secs) !== undefined ? finite(metrics.llm_latency_secs)! * 1_000 : undefined,
      ttsLatencyMs: finite(metrics.tts_latency_secs) !== undefined ? finite(metrics.tts_latency_secs)! * 1_000 : undefined,
      firstTokenLatencyMs: finite(metrics.llm_ttfb_secs) !== undefined ? finite(metrics.llm_ttfb_secs)! * 1_000 : undefined,
      sentiment: typeof turn.sentiment === "string" ? turn.sentiment.slice(0, 40) : undefined,
    } }];
  });
  const started = typeof body.metadata?.start_time_unix_secs === "number" ? body.metadata.start_time_unix_secs : 1;
  const duration = typeof body.metadata?.call_duration_secs === "number" ? body.metadata.call_duration_secs : null;
  const credits = typeof body.metadata?.charging?.credits === "number" ? body.metadata.charging.credits : typeof body.metadata?.cost === "number" ? body.metadata.cost : null;
  return {
    provider: "elevenlabs", providerEventType: "provider_status_reconciliation",
    eventTimestamp: Math.max(1, Math.floor(started + (duration ?? 0))), conversationId: session.provider_conversation_id,
    providerCallId: session.provider_call_id, agentId: body.agent_id,
    outcome: transcript.length ? "completed" : "completed_without_transcript", transcript, durationSeconds: duration,
    providerSummary: typeof body.analysis?.transcript_summary === "string" ? body.analysis.transcript_summary.replace(/https?:\/\/\S+/gi,"[link]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[contact detail]").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g,"[contact detail]").replace(/\s+/g," ").trim().slice(0, 2_000) : null,
    providerCredits: credits,
    providerLlmCredits: finite(body.metadata?.charging?.llm_credits) ?? null,
    providerReportedCost: finite(body.metadata?.cost) ?? null,
    providerEvaluation: finite(body.analysis?.evaluation_criteria_results) ?? null,
    eventKey: `provider_status_reconciliation:${session.provider_conversation_id}`,
  };
}

export async function reconcilePublicExperienceCall(
  session: PublicExperienceSessionRow,
  request: typeof fetch = fetch,
): Promise<PublicCallReconciliationResult> {
  const idle = { providerStatus: "not_requested", normalized: false, completionProcessed: false };
  if (!session.provider_conversation_id || !session.provider_call_id || !["call_dispatched", "call_active"].includes(session.state)) return idle;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ...idle, providerStatus: "configuration_unavailable" };
  const response = await request(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(session.provider_conversation_id)}`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) {
    console.info("[reconcile]", { providerStatus: `http_${response.status}` });
    return { ...idle, providerStatus: `http_${response.status}` };
  }
  const body = await response.json() as ProviderConversation;
  const providerStatus = typeof body.status === "string" ? body.status : "unknown";
  console.info("[reconcile]", { providerStatus });
  const event = publicExperienceProviderConversationEvent(session, body);
  if (!event) return { providerStatus, normalized: false, completionProcessed: false };
  console.info("[completion]", { normalized: true });
  // Let the existing processor hash the normalized event. Passing the event key
  // here used to violate the receipt RPC's required SHA-256 payload contract.
  const processed = await processElevenLabsWebhook(event);
  console.info("[completion]", { processorSucceeded: processed.success });
  return { providerStatus, normalized: true, completionProcessed: processed.success };
}
