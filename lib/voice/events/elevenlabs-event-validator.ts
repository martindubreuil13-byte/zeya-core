import type { ElevenLabsTranscriptSegment, NormalizedElevenLabsEvent, NormalizedElevenLabsOutcome } from "./elevenlabs-event-types";

export const ELEVENLABS_MAX_TRANSCRIPT_TURNS = 200;
export const ELEVENLABS_MAX_TURN_CHARS = 4_000;
const ID = /^[A-Za-z0-9_:.\-]{1,255}$/;

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() && ID.test(value.trim()) ? value.trim() : null;
}

function callId(data: Record<string, unknown>): string | null {
  const direct = string(data.call_id) ?? string(data.provider_call_id) ?? string(data.sip_call_id);
  if (direct) return direct;
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : null;
  const phoneCall = metadata?.phone_call && typeof metadata.phone_call === "object" ? metadata.phone_call as Record<string, unknown> : null;
  return string(phoneCall?.call_sid) ?? string(phoneCall?.call_id);
}

function transcript(value: unknown): ElevenLabsTranscriptSegment[] | null {
  if (!Array.isArray(value) || value.length > ELEVENLABS_MAX_TRANSCRIPT_TURNS) return null;
  const result: ElevenLabsTranscriptSegment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const turn = raw as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "agent") return null;
    if (typeof turn.message !== "string" || !turn.message.trim() || turn.message.length > ELEVENLABS_MAX_TURN_CHARS) return null;
    if (turn.timestamp !== undefined && (typeof turn.timestamp !== "number" || !Number.isFinite(turn.timestamp) || turn.timestamp < 0)) return null;
    result.push({ role: turn.role, message: turn.message.trim(), timestamp: turn.timestamp as number | undefined });
  }
  return result;
}

function failureOutcome(type: string, data: Record<string, unknown>): NormalizedElevenLabsOutcome | null {
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  if (["call_rejected", "conversation_rejected"].includes(type) || status === "rejected") return "rejected";
  if (["call_unanswered", "conversation_unanswered"].includes(type) || ["unanswered", "no_answer"].includes(status)) return "unanswered";
  if (["call_failed", "call_failure", "call_initiation_failure", "conversation_initiation_failure", "post_call_initiation_failure"].includes(type) || status === "failed") return "failed";
  return null;
}

export function normalizeElevenLabsWebhook(event: unknown): NormalizedElevenLabsEvent | null {
  if (!event || typeof event !== "object") return null;
  const root = event as Record<string, unknown>;
  const type = typeof root.type === "string" ? root.type : null;
  const timestamp = root.event_timestamp;
  const data = root.data;
  if (!type || typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0 || !data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const conversationId = string(payload.conversation_id);
  if (!conversationId) return null;
  const providerCallId = callId(payload);
  const agentId = string(payload.agent_id);
  let outcome: NormalizedElevenLabsOutcome;
  let turns: ElevenLabsTranscriptSegment[] = [];
  if (type === "post_call_transcription") {
    if (!agentId) return null;
    const parsed = transcript(payload.transcript);
    if (!parsed || (payload.status !== "done" && payload.status !== "failed")) return null;
    turns = parsed;
    outcome = payload.status === "failed" ? "failed" : parsed.length ? "completed" : "completed_without_transcript";
  } else {
    const failure = failureOutcome(type, payload);
    if (!failure) return null;
    outcome = failure;
  }
  const duration = payload.call_duration;
  if (duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 86_400)) return null;
  return {
    provider: "elevenlabs", providerEventType: type, eventTimestamp: timestamp,
    conversationId, providerCallId, agentId, outcome, transcript: turns,
    durationSeconds: typeof duration === "number" ? duration : null,
    eventKey: `${type}:${conversationId}:${timestamp}`,
  };
}

export function isValidElevenLabsWebhook(event: unknown): boolean {
  return normalizeElevenLabsWebhook(event) !== null;
}

export function isPostCallTranscriptionWebhook(event:unknown):boolean{
  return normalizeElevenLabsWebhook(event)?.providerEventType==="post_call_transcription";
}
