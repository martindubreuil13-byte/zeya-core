import { normalizeTranscriptTurns } from "./transcript-normalization";

type JsonObject = Record<string, unknown>;
type Session = JsonObject & { id: string; tenant_user_id: string };

const PRIVATE_KEYS = /(?:token|secret|authorization|api[_-]?key|system[_-]?(?:prompt|instruction)|private[_-]?(?:prompt|instruction)|phone_hash)/i;

export function sanitizeTestEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTestEvidence);
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
      .replace(/(?:sk|xi)-[A-Za-z0-9_-]{12,}/g, "[redacted secret]");
  }
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => !PRIVATE_KEYS.test(key))
    .map(([key, item]) => [key, sanitizeTestEvidence(item)]));
}

function turns(output: JsonObject | null, channel: "browser" | "veya") {
  const transcript = Array.isArray(output?.transcript) ? output.transcript as Array<{ role?: unknown; text?: unknown; startedAtMs?: unknown; endedAtMs?: unknown; metrics?: unknown }> : [];
  return normalizeTranscriptTurns(transcript).map((turn, index) => ({
    index,
    speaker: turn.role,
    rawTranscript: turn.rawText,
    normalizedTranscript: turn.normalizedText,
    turnStart: turn.startedAtMs ?? null,
    turnEnd: turn.endedAtMs ?? null,
    ...(channel === "veya" ? { providerRelativeTimestamp: turn.startedAtMs ?? null } : {}),
    ...(turn.metrics && typeof turn.metrics === "object" ? turn.metrics : {}),
  }));
}

function event(name: string, at: unknown, source: string) {
  return typeof at === "string" && at ? { name, at, source } : null;
}

export function buildExperienceTestRecord(input: {
  session: Session;
  zeyaOutput: JsonObject | null;
  veyaOutput: JsonObject | null;
  brief: JsonObject | null;
  candidates: JsonObject[];
  storedRecord?: JsonObject | null;
}) {
  const { session, zeyaOutput, veyaOutput, brief, candidates } = input;
  const metadata = veyaOutput?.safe_metadata && typeof veyaOutput.safe_metadata === "object"
    ? veyaOutput.safe_metadata as JsonObject : {};
  const browserConversation = turns(zeyaOutput, "browser");
  const veyaConversation = turns(veyaOutput, "veya");
  const callStarted = typeof veyaOutput?.started_at === "string" ? Date.parse(veyaOutput.started_at) : NaN;
  const absoluteVeya = veyaConversation.map((turn) => ({
    ...turn,
    absoluteTimestamp: Number.isFinite(callStarted) && typeof turn.providerRelativeTimestamp === "number"
      ? new Date(callStarted + turn.providerRelativeTimestamp).toISOString() : null,
  }));
  const timeline = [
    event("session_created", session.created_at, "session"),
    event("zeya_finalized", session.zeya_finalized_at, "browser"),
    event("call_requested", session.call_requested_at, "session"),
    event("call_dispatched", session.call_dispatched_at, "provider"),
    event("call_ended", veyaOutput?.completed_at ?? session.call_completed_at, "provider"),
    event("completion_received", session.call_completed_at, "server"),
    event("transcript_finalized", veyaOutput?.completed_at, "provider"),
    event("brief_generated", brief?.created_at, "reflection"),
  ].filter(Boolean);
  const duration = typeof metadata.durationSeconds === "number" ? metadata.durationSeconds : null;
  const credits = typeof metadata.providerCredits === "number" ? metadata.providerCredits : null;
  const evidenceItems = candidates.filter((item) => item && typeof item === "object");

  return sanitizeTestEvidence({
    schemaVersion: "2.1",
    session: {
      sessionId: session.id,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      deploymentIdentifier: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      experienceVersion: "2.1",
      representationVersion: session.canonical_version_id,
      createdAt: session.created_at,
      completionState: session.state,
    },
    browserConversation,
    veyaConversation: absoluteVeya,
    provider: {
      conversationId: session.provider_conversation_id,
      summary: metadata.providerSummary ?? null,
      durationSeconds: duration,
      messageCount: metadata.turnCount ?? absoluteVeya.length,
      credits,
      llmCredits: metadata.providerLlmCredits ?? null,
      reportedCost: metadata.providerReportedCost ?? null,
      evaluation: metadata.providerEvaluation ?? null,
      completionReason: veyaOutput?.completion_reason ?? null,
      costPerMinute: typeof metadata.providerReportedCost === "number" && duration && duration > 0 ? metadata.providerReportedCost / (duration / 60) : null,
      costPerCompletedEvidenceItem: typeof metadata.providerReportedCost === "number" && evidenceItems.length ? metadata.providerReportedCost / evidenceItems.length : null,
    },
    postCallPipeline: {
      callEnded: veyaOutput?.completed_at ?? null,
      completionReceived: session.call_completed_at ?? null,
      browserDetectedCompletion: input.storedRecord?.browser_detected_completion_at ?? null,
      firstVisibleAcknowledgement: input.storedRecord?.first_visible_acknowledgement_at ?? null,
      transcriptAvailable: veyaOutput?.completed_at ?? null,
      reflectionStarted: input.storedRecord?.reflection_started_at ?? null,
      briefGenerated: brief?.created_at ?? null,
      briefDisplayed: input.storedRecord?.brief_displayed_at ?? null,
      firstPostCallVoiceStarted: input.storedRecord?.first_post_call_voice_started_at ?? null,
    },
    interpretationTrace: {
      normalizedEvidence: evidenceItems,
      rejectedEvidence: [],
      generatorInput: brief?.evidence_references ?? [],
      rawGeneratorOutput: brief?.structured_brief ?? null,
      validationAdjustments: brief?.validation_outcome ?? null,
      finalDisplayedBrief: brief?.structured_brief ?? null,
    },
    unifiedTimeline: timeline,
    errorsAndRetries: input.storedRecord?.errors_and_retries ?? [],
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function experienceTestRecordHtml(record: ReturnType<typeof buildExperienceTestRecord>) {
  const data = record as JsonObject;
  const section = (title: string, value: unknown) => `<section><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Zeya Experience Test Record</title><style>body{font:14px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#202020}h1,h2{font-family:Georgia,serif}section{margin:32px 0}pre{white-space:pre-wrap;background:#f5f3ee;padding:16px;border-radius:8px}@media print{body{margin:0}}</style></head><body><h1>Zeya Experience Test Record</h1>${section("Session overview", data.session)}${section("Unified timeline", data.unifiedTimeline)}${section("Browser transcript", data.browserConversation)}${section("Veya transcript and latency", data.veyaConversation)}${section("Post-call pipeline", data.postCallPipeline)}${section("Evidence classifications", data.interpretationTrace)}${section("Provider usage and cost", data.provider)}${section("Errors and retries", data.errorsAndRetries)}</body></html>`;
}
